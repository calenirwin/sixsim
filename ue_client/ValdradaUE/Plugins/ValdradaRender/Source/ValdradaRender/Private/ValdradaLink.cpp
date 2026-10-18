#include "ValdradaLink.h"
#include "Sockets.h"
#include "SocketSubsystem.h"
#include "IPAddress.h"
#include "HAL/RunnableThread.h"
#include "HAL/PlatformProcess.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "Misc/CoreDelegates.h"
#include "Misc/OutputDeviceRedirector.h"
#include "CoreGlobals.h"

DEFINE_LOG_CATEGORY_STATIC(LogValdradaLink, Log, All);

namespace
{
	constexpr uint8 KindJson = 1, KindBlob = 2;
	constexpr uint32 MaxFrame = 1024u * 1024u * 1024u;
}

FValdradaLink::FValdradaLink(const FString& InHost, int32 InPort) : Host(InHost), Port(InPort) {}

FValdradaLink::~FValdradaLink()
{
	Shutdown();
}

void FValdradaLink::Start()
{
	if (Thread) return;
	bRun = true;
	Thread = FRunnableThread::Create(this, TEXT("ValdradaLink"), 0, TPri_Normal);
}

void FValdradaLink::Shutdown()
{
	bRun = false;
	{
		FScopeLock L(&SendLock);
		if (Socket) Socket->Shutdown(ESocketShutdownMode::ReadWrite);
	}
	if (Thread) { Thread->WaitForCompletion(); delete Thread; Thread = nullptr; }
	Drop();
	FValdradaMessage* M = nullptr;
	while (Inbox.Dequeue(M)) delete M;
}

void FValdradaLink::Stop()
{
	bRun = false;
}

void FValdradaLink::Drop()
{
	FScopeLock L(&SendLock);
	if (Socket)
	{
		Socket->Close();
		ISocketSubsystem::Get(PLATFORM_SOCKETSUBSYSTEM)->DestroySocket(Socket);
		Socket = nullptr;
	}
	bConnected = false;
}

bool FValdradaLink::ConnectOnce()
{
	ISocketSubsystem* SS = ISocketSubsystem::Get(PLATFORM_SOCKETSUBSYSTEM);
	TSharedRef<FInternetAddr> Addr = SS->CreateInternetAddr();
	bool bValid = false;
	Addr->SetIp(*Host, bValid);
	if (!bValid)
	{
		// a host name: resolve it
		FAddressInfoResult R = SS->GetAddressInfo(*Host, nullptr, EAddressInfoFlags::Default, NAME_None, ESocketType::SOCKTYPE_Streaming);
		if (R.ReturnCode != SE_NO_ERROR || R.Results.Num() == 0) return false;
		Addr = R.Results[0].Address->Clone();
	}
	Addr->SetPort(Port);
	FSocket* S = SS->CreateSocket(NAME_Stream, TEXT("valdrada-core"), Addr->GetProtocolType());
	if (!S) return false;
	S->SetNoDelay(true);
	int32 Size = 0;
	S->SetReceiveBufferSize(8 * 1024 * 1024, Size);
	S->SetSendBufferSize(8 * 1024 * 1024, Size);
	if (!S->Connect(*Addr) || S->GetConnectionState() != SCS_Connected)
	{
		S->Close();
		SS->DestroySocket(S);
		return false;
	}
	{
		FScopeLock L(&SendLock);
		Socket = S;
	}
	bConnected = true;
	bFreshConnection = true;
	UE_LOG(LogValdradaLink, Log, TEXT("connected to the core at %s:%d"), *Host, Port);
	return true;
}

bool FValdradaLink::RecvExact(uint8* Dst, int64 N)
{
	int64 Got = 0;
	while (Got < N && bRun)
	{
		int32 Read = 0;
		const int32 Want = int32(FMath::Min<int64>(N - Got, 64 * 1024 * 1024));
		if (!Socket->Recv(Dst + Got, Want, Read, ESocketReceiveFlags::None))
		{
			// a signal (the engine's child processes) interrupts a blocking read; anything else ends the connection
			const ESocketErrors E = ISocketSubsystem::Get(PLATFORM_SOCKETSUBSYSTEM)->GetLastErrorCode();
			if (E == SE_EINTR || E == SE_EWOULDBLOCK || E == SE_TRY_AGAIN) { if (E != SE_EINTR) FPlatformProcess::Sleep(0.001f); continue; }
			UE_LOG(LogValdradaLink, Warning, TEXT("read failed: %s"), ISocketSubsystem::Get(PLATFORM_SOCKETSUBSYSTEM)->GetSocketError(E));
			return false;
		}
		if (Read <= 0) return false;   // the core closed the connection
		Got += Read;
	}
	return Got == N;
}

bool FValdradaLink::RecvFrame(uint8& Kind, TArray<uint8>& Payload)
{
	uint8 Head[5];
	if (!RecvExact(Head, 5)) return false;
	const uint32 N = (uint32(Head[0]) << 24) | (uint32(Head[1]) << 16) | (uint32(Head[2]) << 8) | uint32(Head[3]);
	if (N < 1 || N > MaxFrame) return false;
	Kind = Head[4];
	Payload.SetNumUninitialized(int64(N) - 1);
	return N == 1 || RecvExact(Payload.GetData(), int64(N) - 1);
}

uint32 FValdradaLink::Run()
{
	double LastNote = 0;
	while (bRun)
	{
		if (!Socket)
		{
			if (!ConnectOnce())
			{
				const double Now = FPlatformTime::Seconds();
				if (Now - LastNote > 10) { UE_LOG(LogValdradaLink, Log, TEXT("waiting for the core at %s:%d"), *Host, Port); LastNote = Now; }
				FPlatformProcess::Sleep(1.0f);
				continue;
			}
		}
		uint8 Kind = 0;
		TArray<uint8> Payload;
		if (!RecvFrame(Kind, Payload))
		{
			if (bRun) UE_LOG(LogValdradaLink, Warning, TEXT("the core closed the connection"));
			Drop();
			continue;
		}
		if (Kind != KindJson) continue;   // a blob nobody announced
		FValdradaMessage* M = new FValdradaMessage();
		const FUTF8ToTCHAR Conv(reinterpret_cast<const ANSICHAR*>(Payload.GetData()), Payload.Num());
		const FString Text(Conv.Length(), Conv.Get());
		TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Text);
		if (!FJsonSerializer::Deserialize(Reader, M->Json) || !M->Json.IsValid())
		{
			UE_LOG(LogValdradaLink, Warning, TEXT("a message that is not JSON (%d bytes)"), Payload.Num());
			delete M;
			continue;
		}
		const int32 NBlobs = M->Json->HasField(TEXT("blobs")) ? int32(M->Json->GetNumberField(TEXT("blobs"))) : 0;
		bool bOk = true;
		for (int32 I = 0; I < NBlobs && bOk; ++I)
		{
			uint8 K2 = 0;
			TArray<uint8>& B = M->Blobs.AddDefaulted_GetRef();
			bOk = RecvFrame(K2, B) && K2 == KindBlob;
		}
		if (!bOk)
		{
			delete M;
			Drop();
			continue;
		}
		Inbox.Enqueue(M);
	}
	return 0;
}

bool FValdradaLink::Poll(FValdradaMessage& Out)
{
	FValdradaMessage* M = nullptr;
	if (!Inbox.Dequeue(M)) return false;
	Out = MoveTemp(*M);
	delete M;
	return true;
}

bool FValdradaLink::SendRaw(const uint8* Data, int64 N)
{
	int64 Sent = 0;
	while (Sent < N)
	{
		int32 Wrote = 0;
		const int32 Want = int32(FMath::Min<int64>(N - Sent, 16 * 1024 * 1024));
		if (!Socket->Send(Data + Sent, Want, Wrote))
		{
			const ESocketErrors E = ISocketSubsystem::Get(PLATFORM_SOCKETSUBSYSTEM)->GetLastErrorCode();
			if (E == SE_EINTR || E == SE_EWOULDBLOCK || E == SE_TRY_AGAIN) { if (E != SE_EINTR) FPlatformProcess::Sleep(0.001f); continue; }
			return false;
		}
		Sent += Wrote;
	}
	return true;
}

bool FValdradaLink::Send(const TSharedRef<FJsonObject>& Obj, const TArray<TArrayView<const uint8>>& Blobs)
{
	if (Blobs.Num() > 0) Obj->SetNumberField(TEXT("blobs"), Blobs.Num());
	FString Text;
	TSharedRef<TJsonWriter<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>> W = TJsonWriterFactory<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>::Create(&Text);
	FJsonSerializer::Serialize(Obj, W);
	const FTCHARToUTF8 Utf8(*Text);
	FScopeLock L(&SendLock);
	if (!Socket || !bConnected) return false;
	auto Frame = [this](uint8 Kind, const uint8* Data, int64 N) -> bool
	{
		const uint32 Len = uint32(N + 1);
		const uint8 Head[5] = { uint8(Len >> 24), uint8(Len >> 16), uint8(Len >> 8), uint8(Len), Kind };
		return SendRaw(Head, 5) && (N == 0 || SendRaw(Data, N));
	};
	bool bOk = Frame(KindJson, reinterpret_cast<const uint8*>(Utf8.Get()), Utf8.Length());
	for (const TArrayView<const uint8>& B : Blobs)
		if (bOk) bOk = Frame(KindBlob, B.GetData(), B.Num());
	if (!bOk) UE_LOG(LogValdradaLink, Warning, TEXT("send failed"));
	return bOk;
}

void FValdradaLink::NotePending(int32 Capture, bool bWaiting)
{
	FScopeLock L(&PendingLock);
	if (bWaiting) PendingCaptures.Add(Capture); else PendingCaptures.Remove(Capture);
}

int32 FValdradaLink::CancelPending()
{
	TArray<int32> Ids;
	{
		FScopeLock L(&PendingLock);
		Ids = PendingCaptures.Array();
		PendingCaptures.Reset();
	}
	for (int32 Id : Ids)
	{
		TSharedRef<FJsonObject> P = MakeShared<FJsonObject>(), E = MakeShared<FJsonObject>(), M = MakeShared<FJsonObject>();
		E->SetStringField(TEXT("code"), TEXT("renderer_exiting"));
		E->SetStringField(TEXT("message"), TEXT("the renderer is shutting down"));
		P->SetNumberField(TEXT("capture"), Id);
		P->SetObjectField(TEXT("error"), E);
		M->SetNumberField(TEXT("id"), CancelId++);
		M->SetStringField(TEXT("method"), TEXT("render.result"));
		M->SetObjectField(TEXT("params"), P);
		Send(M);
	}
	return Ids.Num();
}

FValdradaExitWatch::FValdradaExitWatch(FValdradaLink* InLink, float InGraceSeconds) : Link(InLink), GraceSeconds(InGraceSeconds)
{
	Thread = FRunnableThread::Create(this, TEXT("ValdradaExitWatch"), 0, TPri_Normal);
}

FValdradaExitWatch::~FValdradaExitWatch()
{
	bRun = false;
	if (Thread) { Thread->WaitForCompletion(); delete Thread; Thread = nullptr; }
}

uint32 FValdradaExitWatch::Run()
{
	while (bRun && !IsEngineExitRequested()) FPlatformProcess::Sleep(0.1f);
	if (!bRun) return 0;
	if (Link) Link->CancelPending();
	const double T0 = FPlatformTime::Seconds();
	while (bRun && FPlatformTime::Seconds() - T0 < GraceSeconds) FPlatformProcess::Sleep(0.1f);
	if (!bRun) return 0;   // (the game thread got to EndPlay, which ends the process itself)
	UE_LOG(LogValdradaLink, Warning, TEXT("exit requested %.0f s ago and the game thread has not stopped: ending the process"), GraceSeconds);
	if (GLog) GLog->Flush();
	FPlatformMisc::RequestExitWithStatus(true, 0);
	return 0;
}

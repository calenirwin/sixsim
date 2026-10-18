// The connection to the headless core (docs/api/protocol.md framing): [u32 big-endian length N][u8 kind][N-1 bytes],
// kind 1 JSON, kind 2 a binary blob; a JSON message with `blobs: n` is followed by its n blobs. A reader thread parses
// whole messages into a queue the game thread drains; sends are serialised by a lock and may come from any thread.
#pragma once

#include "CoreMinimal.h"
#include "HAL/Runnable.h"
#include "Containers/Queue.h"
#include "Dom/JsonObject.h"
#include <atomic>

class FSocket;
class FRunnableThread;

struct FValdradaMessage
{
	TSharedPtr<FJsonObject> Json;
	TArray<TArray<uint8>> Blobs;
};

class FValdradaLink : public FRunnable
{
public:
	FValdradaLink(const FString& InHost, int32 InPort);
	virtual ~FValdradaLink();

	/** starts the reader thread, which connects (again every second until the core answers) and reads */
	void Start();
	/** closes the socket and joins the thread */
	void Shutdown();

	bool IsConnected() const { return bConnected.load(); }
	/** true once after every (re)connection: the caller says hello again */
	bool TakeConnectedEdge() { return bFreshConnection.exchange(false); }

	/** one JSON message and its blobs, framed; false if the connection is down */
	bool Send(const TSharedRef<FJsonObject>& Obj, const TArray<TArrayView<const uint8>>& Blobs = TArray<TArrayView<const uint8>>());
	/** the next complete message, on the game thread */
	bool Poll(FValdradaMessage& Out);

	/** the captures the core waits for (render.capture ids), kept here so a stop can answer them from any thread */
	void NotePending(int32 Capture, bool bWaiting);
	/** each waiting capture answered renderer_exiting; returns how many */
	int32 CancelPending();

	// FRunnable
	virtual uint32 Run() override;
	virtual void Stop() override;

private:
	bool ConnectOnce();
	bool RecvExact(uint8* Dst, int64 N);
	bool RecvFrame(uint8& Kind, TArray<uint8>& Payload);
	bool SendRaw(const uint8* Data, int64 N);
	void Drop();

	FString Host;
	int32 Port = 2000;
	FSocket* Socket = nullptr;
	FRunnableThread* Thread = nullptr;
	FCriticalSection SendLock;
	TQueue<FValdradaMessage*, EQueueMode::Spsc> Inbox;
	std::atomic<bool> bRun{ false };
	std::atomic<bool> bConnected{ false };
	std::atomic<bool> bFreshConnection{ false };
	FCriticalSection PendingLock;
	TSet<int32> PendingCaptures;
	int32 CancelId = 1000000000;
};

/** Ends the process when the engine's exit was requested (SIGTERM, SIGINT) but the game thread does not get there, as when
 *  it waits on a frame the GPU never finishes: the waiting captures are answered, the log flushed, then after
 *  GraceSeconds the process exits without the world's teardown. */
class FValdradaExitWatch : public FRunnable
{
public:
	FValdradaExitWatch(FValdradaLink* InLink, float InGraceSeconds);
	virtual ~FValdradaExitWatch();
	virtual uint32 Run() override;
	virtual void Stop() override { bRun = false; }
private:
	FValdradaLink* Link;
	float GraceSeconds;
	FRunnableThread* Thread = nullptr;
	std::atomic<bool> bRun{ true };
};

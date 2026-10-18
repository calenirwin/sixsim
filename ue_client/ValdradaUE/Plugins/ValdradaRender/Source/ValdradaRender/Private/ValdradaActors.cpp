// render.state -> the road users. The state's blob is one ATRK v1 frame block (docs/specs/actor-tracks.md): 52-byte
// vehicle records, 44-byte walker records, one signal byte per listed junction, 72-byte train car records; actors.add
// names each actor once (a parked vehicle with its pose). Vehicles of a kind are one instanced mesh, every frame placed
// from the records: the kind's mesh from FleetPath/<kind>/SM_<kind> when the fleet library holds it, else a box of the
// kind's size. Walkers are capsule stand-ins and train cars boxes (the crowd's skinned bodies and the train sets are not
// in this client yet).
#include "ValdradaClient.h"
#include "ValdradaLink.h"
#include "ValdradaFrames.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "Materials/MaterialInstanceDynamic.h"

DEFINE_LOG_CATEGORY_STATIC(LogValdradaActors, Log, All);

namespace
{
	constexpr int32 VehBytes = 52, WalkBytes = 44, TrainBytes = 72;
	template <typename T> T Rd(const uint8* P) { T V; FMemory::Memcpy(&V, P, sizeof(T)); return V; }

	// segRender.js classifyVehicle: the semantic class of a fleet kind
	int32 VehicleClass(const FString& Kind)
	{
		if (Kind == TEXT("bus") || Kind == TEXT("minibus")) return 20;
		static const TCHAR* Trucks[] = { TEXT("sprinter"), TEXT("ambulance"), TEXT("vwvan"), TEXT("van"), TEXT("truck"), TEXT("firetruck"), TEXT("carlacola"), TEXT("cybertruck") };
		for (const TCHAR* T : Trucks) if (Kind.Contains(T, ESearchCase::IgnoreCase)) return 21;
		return 19;
	}

	UInstancedStaticMeshComponent* MakeISM(AActor* Owner, UStaticMesh* Mesh)
	{
		UInstancedStaticMeshComponent* C = NewObject<UInstancedStaticMeshComponent>(Owner);
		C->SetMobility(EComponentMobility::Movable);
		C->SetStaticMesh(Mesh);
		C->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		C->SetupAttachment(Owner->GetRootComponent());
		C->RegisterComponent();
		return C;
	}
}

namespace
{
	template <typename TSlots>
	void SyncSlots(UInstancedStaticMeshComponent* C, TSlots& S, const TArray<TPair<int32, FTransform>>& Items)
	{
		TSet<int32> Seen;
		Seen.Reserve(Items.Num());
		for (const TPair<int32, FTransform>& It : Items)
		{
			Seen.Add(It.Key);
			if (const int32* I = S.Slot.Find(It.Key)) { C->UpdateInstanceTransform(*I, It.Value, true, false, false); continue; }
			int32 I = S.Free.Num() > 0 ? S.Free.Pop() : INDEX_NONE;
			if (I == INDEX_NONE) I = C->AddInstance(It.Value, true);
			else C->UpdateInstanceTransform(I, It.Value, true, false, true);   // (a reused slot jumps: no motion from its last actor)
			S.Slot.Add(It.Key, I);
		}
		for (auto It = S.Slot.CreateIterator(); It; ++It)
		{
			if (Seen.Contains(It.Key())) continue;
			C->UpdateInstanceTransform(It.Value(), FTransform(FQuat::Identity, FVector(0, 0, -100000), FVector::ZeroVector), true, false, true);
			S.Free.Add(It.Value());
			It.RemoveCurrent();
		}
		// (no render state rebuild: the component's instance data manager sends the changed instances; rebuilding every
		// non-Nanite instance buffer each frame ran Vulkan's upload heap out of memory and lost the device)
	}
}

void AValdradaClient::SetupKinds(const TArray<TSharedPtr<FJsonValue>>& Kinds)
{
	if (KindNames.Num() == Kinds.Num()) return;
	UStaticMesh* Box = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cube.Cube"));
	int32 Fleet = 0;
	FString Boxes;
	for (const TSharedPtr<FJsonValue>& V : Kinds)
	{
		const TSharedPtr<FJsonObject> K = V->AsObject();
		const FString Name = K->GetStringField(TEXT("kind"));
		double Sz[3] = { 1.9, 1.5, 4.6 };
		Valdrada::Num3(K, TEXT("size"), Sz, 3);
		KindNames.Add(Name);
		KindSizes.Add(FVector3f(Sz[0], Sz[1], Sz[2]));
		// a kind that repaints another's model (taxi2: the lincoln in the TLC yellow) draws that model
		FString Model = Name, Base;
		UStaticMesh* M = LoadObject<UStaticMesh>(nullptr, *FString::Printf(TEXT("%s/%s/SM_%s.SM_%s"), *FleetPath, *Model, *Model, *Model), nullptr, LOAD_NoWarn | LOAD_Quiet);
		if (!M && K->TryGetStringField(TEXT("base"), Base) && !Base.IsEmpty())
			M = LoadObject<UStaticMesh>(nullptr, *FString::Printf(TEXT("%s/%s/SM_%s.SM_%s"), *FleetPath, *Base, *Base, *Base), nullptr, LOAD_NoWarn | LOAD_Quiet);
		FString Palette;
		KindTaxiPaint.Add(M && !Base.IsEmpty() && K->TryGetStringField(TEXT("palette"), Palette) && Palette == TEXT("taxi"));
		KindIsBox.Add(M == nullptr);
		if (M) ++Fleet; else Boxes += TEXT(" ") + Name;
		KindMesh.Add(M ? M : Box);
		KindISM.Add(nullptr);
		KindSlots.AddDefaulted();
	}
	UE_LOG(LogValdradaActors, Log, TEXT("%d vehicle kinds, %d from the fleet library; boxes:%s"), KindNames.Num(), Fleet, *Boxes);
}

void AValdradaClient::OnState(FValdradaMessage& M)
{
	const TSharedPtr<FJsonObject>& J = M.Json;
	++StatesSeen;
	const TSharedPtr<FJsonObject>* O = nullptr;
	if (J->TryGetObjectField(TEXT("env"), O)) ApplyEnv(*O);
	if (J->TryGetObjectField(TEXT("view"), O)) ApplyView(*O);
	if (J->TryGetObjectField(TEXT("actors"), O))
	{
		const TArray<TSharedPtr<FJsonValue>>* A = nullptr;
		if ((*O)->TryGetArrayField(TEXT("remove"), A)) for (const TSharedPtr<FJsonValue>& V : *A) Statics.Remove(int32(V->AsNumber()));
		if ((*O)->TryGetArrayField(TEXT("add"), A))
			for (const TSharedPtr<FJsonValue>& V : *A)
			{
				const TSharedPtr<FJsonObject> R = V->AsObject();
				FStatic S;
				S.Type = R->GetStringField(TEXT("type"));
				if (S.Type == TEXT("parked"))
				{
					double P[3] = { R->GetNumberField(TEXT("x")), R->GetNumberField(TEXT("y")), R->GetNumberField(TEXT("z")) }, Q[4] = { 0, 0, 0, 1 };
					Valdrada::Num3(R, TEXT("q"), Q, 4);
					S.Kind = int32(R->GetNumberField(TEXT("kind_index")));
					S.Xf = FTransform(Valdrada::Quat(Q[0], Q[1], Q[2], Q[3]), Valdrada::Pos(P[0], P[1], P[2]));
				}
				Statics.Add(int32(R->GetNumberField(TEXT("id"))), S);
			}
	}
	if (M.Blobs.Num() == 0 || KindNames.Num() == 0) return;
	const TArray<uint8>& B = M.Blobs[0];
	if (B.Num() < 8) return;
	const uint8* D = B.GetData();
	const int32 NV = Rd<uint16>(D), NW = Rd<uint16>(D + 2), NS = Rd<uint16>(D + 4), NT = Rd<uint16>(D + 6);
	const int64 Need = 8 + int64(NV) * VehBytes + int64(NW) * WalkBytes + ((NS + 3) & ~3) + int64(NT) * TrainBytes;
	if (B.Num() < Need) { UE_LOG(LogValdradaActors, Warning, TEXT("a state's frame block is short: %d of %lld bytes"), B.Num(), Need); return; }
	TArray<TArray<TPair<int32, FTransform>>> PerKind;
	PerKind.SetNum(KindNames.Num());
	auto Place = [&](int32 Kind, int32 Id, const FTransform& Body)
	{
		if (!PerKind.IsValidIndex(Kind)) return;
		if (KindIsBox[Kind])
		{
			// the model's frame: it faces +z with its left side at +x (sim/fleet24.js), Unreal +Y and +X; size [w, h, l]
			const FVector3f& S = KindSizes[Kind];
			PerKind[Kind].Emplace(Id, FTransform(FQuat::Identity, FVector(0, 0, S.Y * 50.0), FVector(S.X, S.Z, S.Y)) * Body);
		}
		else PerKind[Kind].Emplace(Id, Body);
	};
	const uint8* P = D + 8;
	for (int32 I = 0; I < NV; ++I, P += VehBytes)
	{
		const FVector L = Valdrada::Pos(Rd<float>(P + 4), Rd<float>(P + 8), Rd<float>(P + 12));
		const FQuat Q = Valdrada::Quat(Rd<float>(P + 16), Rd<float>(P + 20), Rd<float>(P + 24), Rd<float>(P + 28));
		Place(Rd<uint16>(P + 50), int32(Rd<uint32>(P)), FTransform(Q, L));
	}
	for (const TPair<int32, FStatic>& KV : Statics) if (KV.Value.Type == TEXT("parked")) Place(KV.Value.Kind, KV.Key, KV.Value.Xf);
	TArray<TPair<int32, FTransform>> Walkers;
	Walkers.Reserve(NW);
	for (int32 I = 0; I < NW; ++I, P += WalkBytes)
	{
		const float Sy = Rd<float>(P + 36), Sxz = Rd<float>(P + 32);
		const FVector L = Valdrada::Pos(Rd<float>(P + 4), Rd<float>(P + 8), Rd<float>(P + 12));
		const float H = 1.72f * (Sy > 0.f ? Sy : 1.f);
		Walkers.Emplace(int32(Rd<uint32>(P)), FTransform(FQuat::Identity, L + FVector(0, 0, H * 50.f), FVector(0.42f * (Sxz > 0.f ? Sxz : 1.f), 0.42f * (Sxz > 0.f ? Sxz : 1.f), H)));
	}
	P += (NS + 3) & ~3;
	TArray<TPair<int32, FTransform>> Cars;
	for (int32 I = 0; I < NT; ++I, P += TrainBytes)
	{
		const FVector L = Valdrada::Pos(Rd<float>(P + 4), Rd<float>(P + 8), Rd<float>(P + 12));
		const float Yaw = Rd<float>(P + 16);
		// a car faces +x at yaw 0, turned about +y (up): about Unreal's Z the other way round
		Cars.Emplace(int32(Rd<uint32>(P)), FTransform(FQuat::Identity, FVector(0, 0, 180), FVector(15.5, 2.6, 3.6)) * FTransform(FQuat(FVector::UpVector, -Yaw), L));
	}
	for (int32 K = 0; K < PerKind.Num(); ++K)
	{
		if (PerKind[K].Num() == 0 && !KindISM[K]) continue;
		if (!KindISM[K])
		{
			KindISM[K] = MakeISM(this, KindMesh[K]);
			LabelComponent(KindISM[K], VehicleClass(KindNames[K]));
			if (KindTaxiPaint.IsValidIndex(K) && KindTaxiPaint[K])
			{
				// the body paint in the taxi yellow (the importer's glTF material: its base colour factor)
				for (int32 Slot = 0; Slot < KindISM[K]->GetNumMaterials(); ++Slot)
				{
					UMaterialInterface* Mi = KindISM[K]->GetMaterial(Slot);
					if (!Mi || !Mi->GetName().Contains(TEXT("paint"), ESearchCase::IgnoreCase)) continue;
					UMaterialInstanceDynamic* Paint = KindISM[K]->CreateDynamicMaterialInstance(Slot, Mi);
					for (const TCHAR* Param : { TEXT("BaseColorFactor"), TEXT("Base Color Factor"), TEXT("BaseColor") })
						Paint->SetVectorParameterValue(Param, FLinearColor(0.95f, 0.62f, 0.02f));
				}
			}
		}
		SyncSlots(KindISM[K], KindSlots[K], PerKind[K]);
	}
	if (!WalkerISM) { WalkerISM = MakeISM(this, LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cylinder.Cylinder"))); LabelComponent(WalkerISM, 23); }
	SyncSlots(WalkerISM.Get(), WalkerSlots, Walkers);
	if (!TrainISM) TrainISM = MakeISM(this, LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cube.Cube")));
	SyncSlots(TrainISM.Get(), TrainSlots, Cars);
}

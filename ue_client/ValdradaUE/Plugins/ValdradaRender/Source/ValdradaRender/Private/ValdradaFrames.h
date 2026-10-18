// The core's frame (the tiles': metres, x east, y up, z south) to Unreal's (centimetres, X east, Y south, Z up), as the
// export's ue_light.py ue_pos and tools/core/read_tracks.py to_ue convert it.
#pragma once

#include "CoreMinimal.h"
#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"

namespace Valdrada
{
	inline FVector Pos(double X, double Y, double Z) { return FVector(X * 100.0, Z * 100.0, Y * 100.0); }
	inline FVector Dir(double X, double Y, double Z) { return FVector(X, Z, Y); }
	/** a body's rotation (a vehicle's, a walker's): the same axis swap on the quaternion */
	inline FQuat Quat(double Qx, double Qy, double Qz, double Qw) { return FQuat(-Qx, -Qz, -Qy, Qw); }
	/** a three.js camera (looking down its -z, up +y) as an Unreal view rotation (looking down +X, up +Z) */
	inline FRotator CameraRotation(double Qx, double Qy, double Qz, double Qw)
	{
		const FQuat Q(Qx, Qy, Qz, Qw);
		const FVector F = Q.RotateVector(FVector(0, 0, -1)), U = Q.RotateVector(FVector(0, 1, 0));
		return FRotationMatrix::MakeFromXZ(Dir(F.X, F.Y, F.Z), Dir(U.X, U.Y, U.Z)).Rotator();
	}
	/** the horizontal field of view (Unreal's) from the vertical one and the aspect */
	inline float HFov(double VFovDeg, double Aspect) { return float(FMath::RadiansToDegrees(2.0 * FMath::Atan(FMath::Tan(FMath::DegreesToRadians(VFovDeg) * 0.5) * Aspect))); }

	inline bool Num3(const TSharedPtr<FJsonObject>& O, const TCHAR* Field, double Out[], int32 N)
	{
		const TArray<TSharedPtr<FJsonValue>>* A = nullptr;
		if (!O.IsValid() || !O->TryGetArrayField(Field, A) || A->Num() < N) return false;
		for (int32 I = 0; I < N; ++I) Out[I] = (*A)[I]->AsNumber();
		return true;
	}
}

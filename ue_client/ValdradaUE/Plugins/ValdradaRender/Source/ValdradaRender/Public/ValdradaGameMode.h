// The client's game mode: no pawn, no HUD; the renderer client actor (AValdradaClient) does the rest.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "ValdradaGameMode.generated.h"

UCLASS()
class VALDRADARENDER_API AValdradaGameMode : public AGameModeBase
{
	GENERATED_BODY()

public:
	AValdradaGameMode();
	virtual void StartPlay() override;
};

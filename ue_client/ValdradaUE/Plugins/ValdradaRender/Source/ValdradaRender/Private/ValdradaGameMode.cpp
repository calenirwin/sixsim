#include "ValdradaGameMode.h"
#include "ValdradaClient.h"
#include "EngineUtils.h"
#include "Engine/World.h"

AValdradaGameMode::AValdradaGameMode()
{
	DefaultPawnClass = nullptr;
	bStartPlayersAsSpectators = false;
}

void AValdradaGameMode::StartPlay()
{
	Super::StartPlay();
	UWorld* W = GetWorld();
	for (TActorIterator<AValdradaClient> It(W); It; ++It) return;   // the map holds one already
	FActorSpawnParameters SP;
	SP.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	W->SpawnActor<AValdradaClient>(AValdradaClient::StaticClass(), FTransform::Identity, SP);
}

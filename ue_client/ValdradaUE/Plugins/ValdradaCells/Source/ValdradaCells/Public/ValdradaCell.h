// A city cell as data (docs/notes/ue-city-architecture.md): its instance table (tools/ue/vcel_write.py) read at load and
// drawn as instanced static meshes of the kit, which is imported once; nothing of the cell's kit content is saved in a
// level, so a placement change in the generator rewrites the table and imports nothing.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "ValdradaCell.generated.h"

class UInstancedStaticMeshComponent;

UCLASS()
class VALDRADACELLS_API AValdradaCell : public AActor
{
	GENERATED_BODY()

public:
	AValdradaCell();

	/** the cell's table: an absolute path, or one relative to the project's directory */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Valdrada")
	FString TablePath;

	/** build when play begins (a take's render, a game); in the editor, Build is called by hand */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Valdrada")
	bool bBuildOnBeginPlay = true;

	/** reads the table and makes one instanced static mesh component per instance set; returns the instances made */
	UFUNCTION(BlueprintCallable, CallInEditor, Category = "Valdrada")
	int32 Build();

	/** removes the components a Build made */
	UFUNCTION(BlueprintCallable, CallInEditor, Category = "Valdrada")
	void Clear();

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Valdrada")
	int32 BuiltInstances = 0;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Valdrada")
	float BuildSeconds = 0.f;

protected:
	virtual void BeginPlay() override;

private:
	UPROPERTY(Transient)
	TArray<TObjectPtr<UInstancedStaticMeshComponent>> Made;
};

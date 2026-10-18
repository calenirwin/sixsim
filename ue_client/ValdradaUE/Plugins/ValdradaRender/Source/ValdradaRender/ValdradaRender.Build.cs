using UnrealBuildTool;

public class ValdradaRender : ModuleRules
{
	public ValdradaRender(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine" });
		PrivateDependencyModuleNames.AddRange(new string[] { "Sockets", "Networking", "Json", "RenderCore", "RHI", "ValdradaCells" });
	}
}

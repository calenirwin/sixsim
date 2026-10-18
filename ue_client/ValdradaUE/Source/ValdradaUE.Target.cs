using UnrealBuildTool;
using System.Collections.Generic;

// the packaged client (ValdradaUE.sh / ValdradaUE.exe): the city drawn from the core's state, served over the render protocol
public class ValdradaUETarget : TargetRules
{
	public ValdradaUETarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;
		DefaultBuildSettings = BuildSettingsVersion.V7;
		IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_8;
		ExtraModuleNames.Add("ValdradaUE");
	}
}

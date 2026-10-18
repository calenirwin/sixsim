using UnrealBuildTool;
using System.Collections.Generic;

// the editor build of the client (development: UnrealEditor ValdradaUE.uproject /Game/Client/Maps/City -game)
public class ValdradaUEEditorTarget : TargetRules
{
	public ValdradaUEEditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;
		DefaultBuildSettings = BuildSettingsVersion.V7;
		IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_8;
		ExtraModuleNames.Add("ValdradaUE");
	}
}

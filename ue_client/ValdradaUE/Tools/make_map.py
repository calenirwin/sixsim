"""The client's persistent level, /Game/Client/Maps/City: an empty map whose game mode is the renderer client's
(everything in it is spawned at play: the sun, sky, clouds, the film look, the city's levels, the road users).
Runs inside the editor:

    UnrealEditor-Cmd ue_client/ValdradaUE/ValdradaUE.uproject -run=pythonscript -script=<this file> -unattended -nosplash -nullrhi
"""
import unreal

MAP = '/Game/Client/Maps/City'


def main():
    unreal.EditorLoadingAndSavingUtils.new_blank_map(False)
    world = unreal.EditorLevelLibrary.get_editor_world()
    ws = world.get_world_settings()
    gm = unreal.load_class(None, '/Script/ValdradaRender.ValdradaGameMode')
    if gm is None:
        raise RuntimeError('ValdradaRender is not loaded (build the editor target first: Tools/build_editor.sh)')
    ws.set_editor_property('default_game_mode', gm)
    # the client spawns its own sky and lights; a blank map holds none
    for a in unreal.EditorLevelLibrary.get_all_level_actors():
        if isinstance(a, (unreal.DirectionalLight, unreal.SkyLight, unreal.SkyAtmosphere, unreal.ExponentialHeightFog, unreal.VolumetricCloud)):
            unreal.EditorLevelLibrary.destroy_actor(a)
    ok = unreal.EditorLoadingAndSavingUtils.save_map(world, MAP)
    unreal.log(f'[client map] {MAP} saved: {ok}')


main()

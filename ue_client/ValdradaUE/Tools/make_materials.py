"""The client's own materials (/Game/Client/Materials). M_client_semantic: a post-process material after the tonemapper
that writes each pixel's custom stencil (the semantic class id the client gives every drawn component) as its colour,
stencil / 255 in every channel, so an 8-bit capture reads the class id back exactly. Runs inside the editor:

    UnrealEditor-Cmd ue_client/ValdradaUE/ValdradaUE.uproject -run=pythonscript -script=<this file> -unattended -nosplash -nullrhi
"""
import unreal

DEST = '/Game/Client/Materials'


def semantic():
    eal = unreal.EditorAssetLibrary
    mel = unreal.MaterialEditingLibrary
    path = f'{DEST}/M_client_semantic'
    if eal.does_asset_exist(path):
        eal.delete_asset(path)
    m = unreal.AssetToolsHelpers.get_asset_tools().create_asset('M_client_semantic', DEST, unreal.Material, unreal.MaterialFactoryNew())
    m.set_editor_property('material_domain', unreal.MaterialDomain.MD_POST_PROCESS)
    m.set_editor_property('blendable_location', unreal.BlendableLocation.BL_SCENE_COLOR_AFTER_TONEMAPPING)
    st = mel.create_material_expression(m, unreal.MaterialExpressionSceneTexture, -600, 0)
    st.set_editor_property('scene_texture_id', unreal.SceneTextureId.PPI_CUSTOM_STENCIL)
    mask = mel.create_material_expression(m, unreal.MaterialExpressionComponentMask, -400, 0)
    mask.set_editor_property('r', True)
    mel.connect_material_expressions(st, 'Color', mask, '')
    div = mel.create_material_expression(m, unreal.MaterialExpressionDivide, -200, 0)
    div.set_editor_property('const_b', 255.0)
    mel.connect_material_expressions(mask, '', div, 'A')
    mel.connect_material_property(div, '', unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    mel.recompile_material(m)
    eal.save_asset(path, only_if_is_dirty=False)
    unreal.log(f'[client materials] {path} saved')


semantic()

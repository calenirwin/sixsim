"""Conservative procedural placement mask, not a tree-inventory classifier."""


def excluded_by_water(water_mask, centre):
    # covers includes exterior and hole boundaries; hole interiors are land.
    return bool(water_mask.covers(centre))

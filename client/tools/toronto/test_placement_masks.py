import unittest
from shapely.geometry import Point, Polygon, MultiPolygon
from placement_masks import excluded_by_water


class PlacementMaskTests(unittest.TestCase):
    def test_water_boundary_holes_and_land(self):
        mask = Polygon([(0, 0), (10, 0), (10, 10), (0, 10)],
                       [[(3, 3), (7, 3), (7, 7), (3, 7)]])
        for point in [(1, 1), (0, 5), (0, 0), (3, 5)]:
            self.assertTrue(excluded_by_water(mask, Point(*point)))
        for point in [(5, 5), (-.001, 5), (11, 11)]:
            self.assertFalse(excluded_by_water(mask, Point(*point)))

    def test_disjoint_and_empty_water(self):
        mask = MultiPolygon([Polygon([(0, 0), (1, 0), (1, 1), (0, 1)]),
                             Polygon([(3, 0), (4, 0), (4, 1), (3, 1)])])
        self.assertTrue(excluded_by_water(mask, Point(3.5, .5)))
        self.assertFalse(excluded_by_water(mask, Point(2, .5)))
        self.assertFalse(excluded_by_water(Polygon(), Point(0, 0)))


if __name__ == '__main__':
    unittest.main()

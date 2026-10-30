import unittest
from unittest.mock import patch
import desktop

class DesktopPrivacyTests(unittest.TestCase):
    def test_clipboard_paths_do_not_contain_the_user_home(self):
        for system in ('win32', 'darwin'):
            for browser in ('Chrome', 'Edge', 'Firefox'):
                with self.subTest(system=system, browser=browser), patch.object(desktop.sys, 'platform', system):
                    path=desktop.clipboard_path(browser)
                    self.assertNotIn(str(desktop.Path.home()), path)
                    self.assertIn(browser.lower(), path)
                    if browser == 'Firefox': self.assertTrue(path.endswith('manifest.json'))

if __name__ == '__main__': unittest.main()

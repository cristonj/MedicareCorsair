import http.client
import threading
import unittest
from http.server import ThreadingHTTPServer
from server import Handler


class LocalHelperCorsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def request(self, method, path, origin):
        conn = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
        conn.request(method, path, headers={'Origin': origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type'})
        response = conn.getresponse()
        response.read()
        result = response.status, response.getheader('Access-Control-Allow-Origin'), response.getheader('Access-Control-Allow-Private-Network')
        conn.close()
        return result

    def test_trusted_site_can_preflight_and_read_status(self):
        trusted = 'https://medicarecorsair.netlify.app'
        self.assertEqual(self.request('OPTIONS', '/api/compare', trusted), (204, trusted, 'true'))
        self.assertEqual(self.request('GET', '/api/status', trusted)[:2], (200, trusted))

    def test_other_websites_are_not_granted_cross_origin_access(self):
        status, origin, _ = self.request('OPTIONS', '/api/compare', 'https://other.example')
        self.assertEqual(status, 403)
        self.assertIsNone(origin)
        status, origin, _ = self.request('POST', '/api/compare', 'https://other.example')
        self.assertEqual(status, 403)
        self.assertIsNone(origin)


if __name__ == '__main__': unittest.main()

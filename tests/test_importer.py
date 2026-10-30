import unittest
from backend.importer import parse_quotes, TextOnly

SAMPLE='''Example Plan (PDP)
Example | Plan ID: S0001-001-0
Deductible $700.00
Total Drug & Premium Cost (for 2027)
$1,118.56 Retail pharmacy: Estimated total drug + premium cost
Monthly Premium
$6.30 Includes: Only drug coverage
Pharmacies
2 of 2 of your selected retail pharmacies are in-network
'''


class ImportTests(unittest.TestCase):
    def test_total_is_not_deductible_or_monthly_premium(self):
        quotes,warnings=parse_quotes(SAMPLE,2027)
        self.assertEqual(quotes[0]['annual_total'],1118.56)
        self.assertEqual(quotes[0]['monthly_premium'],6.30)
        self.assertEqual(quotes[0]['annual_drugs'],1042.96)
        self.assertEqual(quotes[0]['id'],'S0001-001-000')
        self.assertEqual(warnings,[])
    def test_wrong_year_rejected(self):
        with self.assertRaisesRegex(ValueError,'Import rejected'): parse_quotes(SAMPLE,2026)
    def test_missing_price_never_becomes_zero(self):
        with self.assertRaises(ValueError): parse_quotes(SAMPLE.replace('$1,118.56','Unavailable'),2027)
    def test_conflicting_duplicate_rejected(self):
        with self.assertRaisesRegex(ValueError,'Conflicting'): parse_quotes(SAMPLE+SAMPLE.replace('$1,118.56','$2,118.56'),2027)
    def test_ocr_id_correction_does_not_alter_amounts(self):
        quotes,_=parse_quotes(SAMPLE.replace('ID: S','ID: $').replace('Monthly Premium\n','Monthly Premium\n$\n'),2027)
        self.assertEqual(quotes[0]['annual_total'],1118.56)
        self.assertEqual(quotes[0]['id'],'S0001-001-000')
    def test_html_scripts_are_not_included(self):
        parser=TextOnly();parser.feed('<html><script>fake $0.00</script><div>'+SAMPLE+'</div></html>')
        text=''.join(parser.parts)
        self.assertNotIn('fake',text)
        self.assertEqual(parse_quotes(text,2027)[0][0]['annual_total'],1118.56)


if __name__=='__main__': unittest.main()

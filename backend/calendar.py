"""Enrollment-year selection; do not confuse the download date with benefit year."""
from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


def enrollment_context(today=None):
    if today is None:
        try:
            today = datetime.now(ZoneInfo("America/Chicago")).date()
        except ZoneInfoNotFoundError:
            # Windows may not have an IANA database; use the local calendar.
            today = datetime.now().date()
    year = today.year
    active = (10, 15) <= (today.month, today.day) <= (12, 7)
    # After the annual deadline, retain the upcoming effective year through Dec 31.
    benefit_year = year + 1 if (today.month, today.day) >= (10, 15) else year
    return {
        "today": today.isoformat(), "year": benefit_year,
        "annual_open_enrollment": active,
        "deadline": f"{year}-12-07" if active else None,
        "effective_date": f"{benefit_year}-01-01",
        "message": (f"Annual Open Enrollment · Coverage starts January 1, {benefit_year}"
                    if active else "Annual Open Enrollment is closed. Other enrollment periods depend on eligibility."),
        "source": "https://www.medicare.gov/health-drug-plans/open-enrollment",
    }

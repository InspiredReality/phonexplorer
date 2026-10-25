from datetime import datetime

from sqlalchemy import Column, Date, DateTime, Float, String, Text

from app.db import Base


class BettStuffSettlement(Base):
    """A finished pick from the Bett Stuff tracker.

    Written once a panel row is marked Closed and resolved (never while
    still Live), and mirrors every field shown on that row. user_id has no
    real accounts to key off yet — every row belongs to the same single
    user today — but the column is here so multi-user support later won't
    need a migration.
    """

    __tablename__ = "bett_stuff_settlements"

    id         = Column(String(64), primary_key=True)  # the panel row's own client-generated id
    user_id    = Column(String(128), nullable=False, default="default", index=True)
    bet_date   = Column(Date, nullable=False)
    pick       = Column(Text, nullable=False, default="")
    notes      = Column(Text, nullable=True)
    image      = Column(Text, nullable=True)
    bet_amount = Column(Float, nullable=False, default=0)
    to_win     = Column(Float, nullable=False, default=0)
    profit     = Column(Float, nullable=False, default=0)
    sportsbook = Column(String(64), nullable=True)
    # JSON-encoded list of strings — stored as plain text rather than a
    # Postgres ARRAY column so it works the same under sqlite in tests.
    tags       = Column(Text, nullable=False, default="[]")
    status     = Column(String(16), nullable=False, default="closed")
    result     = Column(String(16), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

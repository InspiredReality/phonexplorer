from datetime import datetime

from sqlalchemy import Column, DateTime, Integer, String, Text, UniqueConstraint

from app.db import Base


class BetEntry(Base):
    """One cell of the weekly parlay tracker: a team's pick + status for a given week."""

    __tablename__ = "bet_entries"
    __table_args__ = (UniqueConstraint("week", "team_id", name="uq_bet_entries_week_team"),)

    id         = Column(Integer, primary_key=True)
    week       = Column(Integer, nullable=False)
    team_id    = Column(String(64), nullable=False)
    pick       = Column(Text, nullable=False, default="")
    status     = Column(String(16), nullable=False, default="pending")
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

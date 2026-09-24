from sqlalchemy import Column, Integer, String, UniqueConstraint

from app.db import Base


class NflPick(Base):
    """Which team was picked to win a given real NFL game, for the My Bets page.

    Shared/global like the rest of the bets app (no per-user accounts) — the
    "my pick" in the UI just means whoever last clicked a team icon.
    """

    __tablename__ = "nfl_picks"
    __table_args__ = (UniqueConstraint("week", "game_id", name="uq_nfl_picks_week_game"),)

    id      = Column(Integer, primary_key=True)
    week    = Column(Integer, nullable=False)
    game_id = Column(String(32), nullable=False)
    team_id = Column(String(16), nullable=False)

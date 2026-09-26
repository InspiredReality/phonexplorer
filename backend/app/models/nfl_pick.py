from sqlalchemy import Column, Integer, String, UniqueConstraint

from app.db import Base


class NflPick(Base):
    """Which team was picked for a real NFL game, for the My Bets page.

    market is 'moneyline' (straight-up winner) or 'ats' (against the
    spread) — the same game can carry one pick of each. Shared/global like
    the rest of the bets app (no per-user accounts) — the "my pick" in the
    UI just means whoever last clicked a team.
    """

    __tablename__ = "nfl_picks"
    __table_args__ = (
        UniqueConstraint("week", "game_id", "market", name="uq_nfl_picks_week_game_market"),
    )

    id      = Column(Integer, primary_key=True)
    week    = Column(Integer, nullable=False)
    game_id = Column(String(32), nullable=False)
    market  = Column(String(16), nullable=False, default="moneyline")
    team_id = Column(String(16), nullable=False)

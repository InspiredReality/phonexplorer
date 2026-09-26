from sqlalchemy import Boolean, Column, Float, Integer, String

from app.db import Base


class NflGameCache(Base):
    """A full snapshot of one NFL game (matchup, score, odds), cached from
    ESPN's scoreboard.

    Two things this saves us from:
      - Re-hitting ESPN every time someone reopens a week — once every game
        in a week is `completed`, that week's result is permanent, so the
        schedule endpoint serves it straight from here without calling out.
      - Losing the spread once ESPN stops returning odds for a game that's
        no longer upcoming — whatever was last seen here fills the gap.

    A week that's still in progress (not every game completed yet) is never
    treated as "settled": the endpoint keeps fetching it live so scores that
    are still moving keep updating, and only re-caches what changed.
    """

    __tablename__ = "nfl_game_cache"

    game_id        = Column(String(32), primary_key=True)
    week           = Column(Integer, nullable=False)
    season         = Column(Integer, nullable=False)
    date           = Column(String(40), nullable=True)
    completed      = Column(Boolean, nullable=False, default=False)
    total          = Column(Float, nullable=True)  # over/under line — game-level, not per-team

    home_id        = Column(String(16), nullable=True)
    home_name      = Column(String(64), nullable=True)
    home_logo      = Column(String(255), nullable=True)
    home_score     = Column(Integer, nullable=True)
    home_moneyline = Column(Integer, nullable=True)
    home_spread    = Column(Float, nullable=True)

    away_id        = Column(String(16), nullable=True)
    away_name      = Column(String(64), nullable=True)
    away_logo      = Column(String(255), nullable=True)
    away_score     = Column(Integer, nullable=True)
    away_moneyline = Column(Integer, nullable=True)
    away_spread    = Column(Float, nullable=True)

from sqlalchemy import Column, Float, Integer, String

from app.db import Base


class NflGameOdds(Base):
    """Moneyline/spread for one NFL game, cached the first time ESPN serves
    it (while the game is still upcoming).

    ESPN's scoreboard stops including odds for a game once it's no longer
    upcoming — so without this cache, the spread needed to grade a past
    week's ATS pick disappears right along with it. The schedule endpoint
    writes here whenever ESPN gives fresh numbers, and reads from here as a
    fallback whenever ESPN's response comes back without them.
    """

    __tablename__ = "nfl_game_odds"

    game_id        = Column(String(32), primary_key=True)
    week           = Column(Integer, nullable=False)
    home_moneyline = Column(Integer, nullable=True)
    away_moneyline = Column(Integer, nullable=True)
    home_spread    = Column(Float, nullable=True)
    away_spread    = Column(Float, nullable=True)

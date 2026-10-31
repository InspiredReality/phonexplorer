from datetime import datetime

from sqlalchemy import (
    JSON, Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text,
    UniqueConstraint, func,
)

from app.db import Base


class NbaGame(Base):
    """One NBA game. `id` is `YYYYMMDD` + away code + home code (e.g. 20261020BOSDET)."""

    __tablename__ = "nba_games"

    id         = Column(String(32), primary_key=True)
    date       = Column(String(10), nullable=False, index=True)  # ISO YYYY-MM-DD
    home_team  = Column(String(3), nullable=False)
    away_team  = Column(String(3), nullable=False)
    home_score = Column(Integer, nullable=True)
    away_score = Column(Integer, nullable=True)
    # scheduled | pending_review (box total != final score) | final
    status     = Column(String(20), nullable=False, default="scheduled")
    tip_time   = Column(DateTime(timezone=True), nullable=True)
    source_url = Column(String(300), nullable=True)


class NbaBoxLine(Base):
    """One player's line in one game. DNP / inactive players have no row."""

    __tablename__ = "nba_box_lines"
    __table_args__ = (UniqueConstraint("game_id", "team", "player", name="uq_nba_box_line"),)

    id         = Column(Integer, primary_key=True, autoincrement=True)
    game_id    = Column(String(32), ForeignKey("nba_games.id", ondelete="CASCADE"), nullable=False, index=True)
    team       = Column(String(3), nullable=False)
    player     = Column(String(120), nullable=False)
    points     = Column(Integer, nullable=False)
    started    = Column(Boolean, nullable=False, default=False)
    listed_pos = Column(String(10), nullable=True)  # raw label from the source


class NbaPlayer(Base):
    """A player's fixed model position (G/F/C). pos NULL = unassigned."""

    __tablename__ = "nba_players"

    team       = Column(String(3), primary_key=True)
    player     = Column(String(120), primary_key=True)
    pos        = Column(String(1), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class NbaPlayerAlias(Base):
    __tablename__ = "nba_player_aliases"

    team   = Column(String(3), primary_key=True)
    alias  = Column(String(120), primary_key=True)
    player = Column(String(120), nullable=False)  # canonical name


class NbaFormulaVersion(Base):
    __tablename__ = "nba_formula_versions"

    id          = Column(String(64), primary_key=True)
    name        = Column(String(120), nullable=False, unique=True)
    description = Column(Text, nullable=False, default="")
    params      = Column(JSON, nullable=False)
    locked      = Column(Boolean, nullable=False, default=False)
    created_at  = Column(DateTime(timezone=True), server_default=func.now())


class NbaPrediction(Base):
    __tablename__ = "nba_predictions"
    __table_args__ = (
        UniqueConstraint("game_id", "formula_id", "team", "player", name="uq_nba_prediction"),
    )

    id         = Column(Integer, primary_key=True, autoincrement=True)
    game_id    = Column(String(32), ForeignKey("nba_games.id", ondelete="CASCADE"), nullable=False, index=True)
    team       = Column(String(3), nullable=False)
    player     = Column(String(120), nullable=False)
    pos        = Column(String(1), nullable=False)
    formula_id = Column(String(64), ForeignKey("nba_formula_versions.id"), nullable=False, index=True)
    player_avg = Column(Float, nullable=False)
    adj        = Column(Float, nullable=False)
    predicted  = Column(Float, nullable=False)
    is_starter = Column(Boolean, nullable=False, default=True)
    locked     = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class NbaPageCache(Base):
    """Fetched source pages, so re-runs never re-hit the site for settled days."""

    __tablename__ = "nba_page_cache"

    url        = Column(String(300), primary_key=True)
    body       = Column(Text, nullable=False)
    fetched_at = Column(DateTime(timezone=True), server_default=func.now())

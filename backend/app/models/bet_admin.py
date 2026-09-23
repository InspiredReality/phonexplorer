from sqlalchemy import Boolean, Column, Date, Integer, String

from app.db import Base


class BetSeasonConfig(Base):
    """Singleton row (id=1) controlling which weeks are visible.

    active_week is computed from season_start (the date Week 1 becomes
    visible) unless forced_active_week is set, which overrides it.
    """

    __tablename__ = "bet_season_config"

    id = Column(Integer, primary_key=True)
    season_start = Column(Date, nullable=False)
    forced_active_week = Column(Integer, nullable=True)


class BetWeekLock(Base):
    """Per-week lock: when locked, that week's picks/status can no longer be edited.

    Also carries the funder — the team on the hook to pay for that week's
    parlay, set by triple-clicking their icon in the picks table. It locks
    alongside everything else once the week is locked.
    """

    __tablename__ = "bet_week_locks"

    week = Column(Integer, primary_key=True)
    locked = Column(Boolean, nullable=False, default=False)
    funder_team_id = Column(String(64), nullable=True)

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


class BetTeamStanding(Base):
    """Per-team display order, set from the admin page's drag-to-reorder table.

    rank controls both the picks accordion's team order and the Season
    Contributions table's default (unsorted) order. wins/points_for/
    points_against are placeholders for a future external stats feed — the
    admin page only edits rank for now, so they default to 0.
    """

    __tablename__ = "bet_team_standings"

    team_id = Column(String(64), primary_key=True)
    rank = Column(Integer, nullable=False)
    wins = Column(Integer, nullable=False, default=0)
    points_for = Column(Integer, nullable=False, default=0)
    points_against = Column(Integer, nullable=False, default=0)

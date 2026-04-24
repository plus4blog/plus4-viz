-- =============================================================================
-- create_lakehouse_views.sql
-- Run against Bronze_Lakehouse SQL analytics endpoint
--
-- Run block 1 first, then block 2 (vs_expected depends on enriched).
-- If your editor supports GO, run the full file. Otherwise paste each
-- CREATE OR ALTER VIEW statement separately.
--
-- Views created:
--   vw_player_performance_enriched      — deduped base view
--   vw_player_performance_vs_expected   — adds per-player baselines + deltas
-- =============================================================================


-- ── BLOCK 1: vw_player_performance_enriched ───────────────────────────────────
-- Deduplicates [Event History] on (dg_id, event_id, year, round).
-- When duplicates exist, keeps the row with the latest event_completed date.

CREATE OR ALTER VIEW vw_player_performance_enriched AS
WITH ranked AS (
    SELECT
        *,
        ROW_NUMBER() OVER (
            PARTITION BY dg_id, event_id, year, round
            ORDER BY event_completed DESC
        ) AS _rn
    FROM [Event History]
    WHERE dg_id  IS NOT NULL
      AND round   IS NOT NULL
)
SELECT
    -- Identity / event
    tour,
    year,
    season,
    event_id,
    CAST(event_completed AS DATE)  AS event_completed,
    event_name,
    dg_id,
    player_name,
    fin_text,

    -- Course
    course_num,
    course_name,
    course_par,

    -- Round metadata
    round,
    score,
    start_hole,
    score - course_par                 AS score_vs_par,

    -- Scoring breakdown
    eagles_or_better,
    birdies,
    pars,
    bogies,
    doubles_or_worse,

    -- Strokes gained
    sg_ott,
    sg_app,
    sg_arg,
    sg_putt,
    sg_t2g,
    sg_total,

    -- Traditional stats (populated when traditional_stats = 'yes')
    driving_acc,
    driving_dist,
    gir,
    scrambling,
    prox_fw,
    prox_rgh,
    great_shots,
    poor_shots,

    -- Data availability flags
    sg_categories,
    traditional_stats

FROM ranked
WHERE _rn = 1;
GO


-- ── BLOCK 2: vw_player_performance_vs_expected ────────────────────────────────
-- Joins enriched data to each player's career-average baseline per metric.
-- Delta = actual - baseline, so positive = outperformed their own average.
-- SG baselines use only sg_categories = 'yes' rounds.
-- Traditional stat baselines use only traditional_stats = 'yes' rounds.

CREATE OR ALTER VIEW vw_player_performance_vs_expected AS
WITH player_baselines AS (
    SELECT
        dg_id,

        -- SG baselines
        AVG(CASE WHEN sg_categories   = 'yes' THEN sg_ott   END) AS baseline_sg_ott,
        AVG(CASE WHEN sg_categories   = 'yes' THEN sg_app   END) AS baseline_sg_app,
        AVG(CASE WHEN sg_categories   = 'yes' THEN sg_arg   END) AS baseline_sg_arg,
        AVG(CASE WHEN sg_categories   = 'yes' THEN sg_putt  END) AS baseline_sg_putt,
        AVG(CASE WHEN sg_categories   = 'yes' THEN sg_t2g   END) AS baseline_sg_t2g,
        AVG(CASE WHEN sg_categories   = 'yes' THEN sg_total END) AS baseline_sg_total,

        -- Traditional stat baselines
        AVG(CASE WHEN traditional_stats = 'yes' THEN driving_acc  END) AS baseline_driving_acc,
        AVG(CASE WHEN traditional_stats = 'yes' THEN driving_dist END) AS baseline_driving_dist,
        AVG(CASE WHEN traditional_stats = 'yes' THEN gir          END) AS baseline_gir,
        AVG(CASE WHEN traditional_stats = 'yes' THEN scrambling   END) AS baseline_scrambling,
        AVG(CASE WHEN traditional_stats = 'yes' THEN prox_fw      END) AS baseline_prox_fw,
        AVG(CASE WHEN traditional_stats = 'yes' THEN prox_rgh     END) AS baseline_prox_rgh,
        AVG(CASE WHEN traditional_stats = 'yes' THEN great_shots  END) AS baseline_great_shots,
        AVG(CASE WHEN traditional_stats = 'yes' THEN poor_shots   END) AS baseline_poor_shots

    FROM vw_player_performance_enriched
    GROUP BY dg_id
)
SELECT
    e.*,

    -- SG vs player career baseline
    e.sg_ott   - b.baseline_sg_ott   AS sg_ott_vs_expected,
    e.sg_app   - b.baseline_sg_app   AS sg_app_vs_expected,
    e.sg_arg   - b.baseline_sg_arg   AS sg_arg_vs_expected,
    e.sg_putt  - b.baseline_sg_putt  AS sg_putt_vs_expected,
    e.sg_t2g   - b.baseline_sg_t2g   AS sg_t2g_vs_expected,
    e.sg_total - b.baseline_sg_total AS sg_total_vs_expected,

    -- Traditional stats vs player career baseline
    e.driving_acc  - b.baseline_driving_acc  AS driving_acc_vs_expected,
    e.driving_dist - b.baseline_driving_dist AS driving_dist_vs_expected,
    e.gir          - b.baseline_gir          AS gir_vs_expected,
    e.scrambling   - b.baseline_scrambling   AS scrambling_vs_expected,
    e.prox_fw      - b.baseline_prox_fw      AS prox_fw_vs_expected,
    e.prox_rgh     - b.baseline_prox_rgh     AS prox_rgh_vs_expected,
    e.great_shots  - b.baseline_great_shots  AS great_shots_vs_expected,
    e.poor_shots   - b.baseline_poor_shots   AS poor_shots_vs_expected,

    -- Expose baselines for diagnostics / downstream use
    b.baseline_sg_ott,
    b.baseline_sg_app,
    b.baseline_sg_arg,
    b.baseline_sg_putt,
    b.baseline_sg_t2g,
    b.baseline_sg_total,
    b.baseline_driving_acc,
    b.baseline_driving_dist,
    b.baseline_gir,
    b.baseline_scrambling,
    b.baseline_great_shots,
    b.baseline_poor_shots

FROM vw_player_performance_enriched e
LEFT JOIN player_baselines b ON e.dg_id = b.dg_id;
GO

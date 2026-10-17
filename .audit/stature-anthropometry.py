#!/usr/bin/env python3
"""Reproduce the independent stature-panel regressions using pinned ANSUR II data.

Run from any directory, with Python's standard library only:
    python3 .audit/stature-anthropometry.py > .audit/stature-anthropometry.json

Data loading reuses tools/anthro/fit_ansur.py's SHA-256-checked rows(). That
module downloads its pinned public CSVs when its cache is missing. Its normal
TypeScript-generation output is suppressed so this program emits JSON only.
No production files or assets are modified.
"""

import contextlib
import importlib.util
import io
import json
import math
from pathlib import Path
import statistics


ROOT = Path(__file__).resolve().parents[1]
FITTER = ROOT / "tools" / "anthro" / "fit_ansur.py"
SPEC = importlib.util.spec_from_file_location("stature_panel_ansur_source", FITTER)
SOURCE = importlib.util.module_from_spec(SPEC)
with contextlib.redirect_stdout(io.StringIO()):
    SPEC.loader.exec_module(SOURCE)


MEASURES = {
    "headAboveTragion": ("Tragion to top of head", ("tragiontopofhead",)),
    "headBreadth": ("Head breadth", ("headbreadth",)),
    "headLength": ("Head length, front to back", ("headlength",)),
    "headCircumference": ("Head circumference", ("headcircumference",)),
    "neckCircumference": ("Neck circumference", ("neckcircumference",)),
    "flexedUpperArmCircumference": (
        "Flexed upper-arm circumference (ANSUR biceps circumference, flexed)",
        ("bicepscircumferenceflexed",),
    ),
    "flexedForearmCircumference": (
        "Forearm circumference, flexed",
        ("forearmcircumferenceflexed",),
    ),
    "wristCircumference": ("Wrist circumference", ("wristcircumference",)),
    "shoulderBreadth": ("Biacromial shoulder breadth", ("biacromialbreadth",)),
    "upperArmLength": ("Acromion-radiale length", ("acromionradialelength",)),
    "forearmLength": ("Radiale-stylion length", ("radialestylionlength",)),
    "armLength": (
        "Shoulder-to-wrist length, sum of upper-arm and forearm lengths",
        ("acromionradialelength", "radialestylionlength"),
    ),
    "handLength": ("Hand length", ("handlength",)),
    "handBreadth": ("Hand breadth", ("handbreadth",)),
}


def log_fit(predictor, response):
    """OLS on natural logs, with R² in log space (not original millimeters)."""
    if len(predictor) != len(response) or len(predictor) < 3:
        raise ValueError("Regression needs at least three paired observations.")
    if any(value <= 0 or not math.isfinite(value) for value in predictor + response):
        raise ValueError("Log regression requires positive finite observations.")
    x = [math.log(value) for value in predictor]
    y = [math.log(value) for value in response]
    mean_x, mean_y = statistics.fmean(x), statistics.fmean(y)
    sxx = sum((value - mean_x) ** 2 for value in x)
    syy = sum((value - mean_y) ** 2 for value in y)
    sxy = sum((a - mean_x) * (b - mean_y) for a, b in zip(x, y))
    exponent = sxy / sxx
    return {
        "coefficient": math.exp(mean_y - exponent * mean_x),
        "exponent": exponent,
        "rSquaredLogSpace": sxy * sxy / (sxx * syy),
    }


result = {
    "method": {
        "model": "measurement_mm = coefficient * stature_mm ** exponent",
        "estimator": "Unweighted ordinary least squares of natural-log measurement on natural-log stature, with intercept",
        "rSquared": "Computed in natural-log space",
        "scope": "Cross-sectional associations in the separately analyzed female/male public ANSUR II working datasets; not longitudinal growth or validated extreme-height predictions",
        "poseCaution": "Flexed upper-arm and forearm circumferences are not relaxed A-pose circumference targets",
        "reproduce": "python3 .audit/stature-anthropometry.py > .audit/stature-anthropometry.json",
    },
    "sexes": {},
}

for sex in ("female", "male"):
    data = SOURCE.rows(sex)
    url, expected_hash = SOURCE.SOURCES[sex]
    stature = [float(row["stature"]) for row in data]
    age = [float(row["Age"]) for row in data]
    # Only exponent/R² are reported for weight. A constant conversion from the
    # stored weight units to kg would not change either of those statistics.
    raw_weight = [float(row["weightkg"]) for row in data]
    fits = {}
    weight_comparison = {}
    for key, (label, columns) in MEASURES.items():
        values = [sum(float(row[column]) for column in columns) for row in data]
        fits[key] = {
            "measurement": label,
            "sourceColumns": list(columns),
            "sourceAggregation": "sum" if len(columns) > 1 else "direct",
            **log_fit(stature, values),
        }
        if key in (
            "flexedUpperArmCircumference",
            "flexedForearmCircumference",
            "headCircumference",
        ):
            weight_fit = log_fit(raw_weight, values)
            weight_comparison[key] = {
                "predictor": "Raw stored weightkg column; multiplicative unit conversions do not change exponent or R²",
                "exponent": weight_fit["exponent"],
                "rSquaredLogSpace": weight_fit["rSquaredLogSpace"],
            }
    result["sexes"][sex] = {
        "sourceUrl": url,
        "sha256VerifiedByRows": expected_hash,
        "sampleSize": len(data),
        "statureMm": {
            "min": min(stature),
            "p01": SOURCE.percentile(stature, 0.01),
            "p50": SOURCE.percentile(stature, 0.5),
            "p99": SOURCE.percentile(stature, 0.99),
            "max": max(stature),
        },
        "ageYears": {"min": min(age), "max": max(age)},
        "statureFits": fits,
        "separateUnivariateWeightFits": weight_comparison,
    }

print(json.dumps(result, indent=2, allow_nan=False))

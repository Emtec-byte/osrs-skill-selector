function normalizeMultiplier(value, fallback = 1) {
  return Number.isFinite(value) ? value : fallback;
}

function normalizeBoolean(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

export function getLeagueHeaderSummary({ leagueConfig, bonusOverrides = null } = {}) {
  const plannerRules = leagueConfig?.plannerRules ?? {};
  const effectiveBonuses = {
    xpMultiplier: normalizeMultiplier(bonusOverrides?.xpMultiplier, plannerRules.baseXpMultiplier ?? 1),
    dropRateMultiplier: normalizeMultiplier(bonusOverrides?.dropRateMultiplier, plannerRules.baseDropRateMultiplier ?? 1),
    minigamePointMultiplier: normalizeMultiplier(bonusOverrides?.minigamePointMultiplier, plannerRules.minigamePointMultiplier ?? 1),
    unlimitedRun: normalizeBoolean(bonusOverrides?.unlimitedRun, plannerRules.unlimitedRun ?? false),
    ironman: normalizeBoolean(bonusOverrides?.ironman, plannerRules.isIronman ?? false),
  };

  return {
    leagueId: leagueConfig?.id ?? "league",
    leagueLabel: leagueConfig?.label ?? "League",
    effectiveBonuses,
    bubbles: [
      {
        key: "xpMultiplier",
        label: `XP x${effectiveBonuses.xpMultiplier}`,
        variant: "primary",
      },
      {
        key: "dropRateMultiplier",
        label: `Drops x${effectiveBonuses.dropRateMultiplier}`,
        variant: "primary",
      },
      {
        key: "minigamePointMultiplier",
        label: `${effectiveBonuses.minigamePointMultiplier}x points`,
        variant: "secondary",
      },
      effectiveBonuses.unlimitedRun
        ? {
            key: "unlimitedRun",
            label: "Unlimited run",
            variant: "secondary",
          }
        : null,
      effectiveBonuses.ironman
        ? {
            key: "ironman",
            label: "Ironman",
            variant: "secondary",
          }
        : null,
    ].filter(Boolean),
  };
}

export function createLeagueHeaderMeta({ mountEl, leagueConfig, getBonusOverrides = () => null }) {
  if (!mountEl) {
    throw new Error("League header mount element is required.");
  }

  const element = document.createElement("div");
  element.className = "league-header";

  function render() {
    const summary = getLeagueHeaderSummary({
      leagueConfig,
      bonusOverrides: getBonusOverrides(),
    });

    element.innerHTML = `
      <div class="league-header__content">
        <p class="league-header__label">${summary.leagueLabel}</p>
        <div class="league-header__bubbles">
          ${summary.bubbles.map((bubble) => `
            <span class="league-header__bubble${bubble.variant === "primary" ? " league-header__bubble--primary" : ""}" data-bubble-key="${bubble.key}">
              ${bubble.label}
            </span>
          `).join("")}
        </div>
      </div>
    `;
  }

  mountEl.replaceChildren(element);
  render();

  return {
    element,
    render,
    destroy() {
      if (mountEl.contains(element)) {
        mountEl.replaceChildren();
      }
    },
  };
}
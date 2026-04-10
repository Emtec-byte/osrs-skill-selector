const DEFAULT_MOBILE_QUERY = "(max-width: 820px)";

function resolveMatches(mediaQueryList) {
  return mediaQueryList.matches ? "mobile" : "desktop";
}

export function createLayoutEnvironment({ target = window, mobileQuery = DEFAULT_MOBILE_QUERY } = {}) {
  const mediaQueryList = target.matchMedia(mobileQuery);
  const subscribers = new Set();

  function emit() {
    const mode = resolveMatches(mediaQueryList);
    subscribers.forEach((subscriber) => {
      subscriber(mode);
    });
  }

  function handleChange() {
    emit();
  }

  if (typeof mediaQueryList.addEventListener === "function") {
    mediaQueryList.addEventListener("change", handleChange);
  } else {
    mediaQueryList.addListener(handleChange);
  }

  return {
    getMode() {
      return resolveMatches(mediaQueryList);
    },

    subscribe(subscriber) {
      if (typeof subscriber !== "function") {
        return () => {};
      }

      subscribers.add(subscriber);
      subscriber(resolveMatches(mediaQueryList));

      return () => {
        subscribers.delete(subscriber);
      };
    },

    destroy() {
      subscribers.clear();

      if (typeof mediaQueryList.removeEventListener === "function") {
        mediaQueryList.removeEventListener("change", handleChange);
      } else {
        mediaQueryList.removeListener(handleChange);
      }
    },
  };
}
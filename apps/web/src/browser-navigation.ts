import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import { parseLocation, type BrowserRoute } from "./browser-route.js";

export type BrowserNavigation = {
  route: BrowserRoute;
  routeError: boolean;
  setRouteError: Dispatch<SetStateAction<boolean>>;
  pushRoute: (url: string) => void;
  replaceRoute: (url: string) => void;
};

export function useBrowserNavigation(): BrowserNavigation {
  const [route, setRoute] = useState<BrowserRoute>(parseLocation);
  const [routeError, setRouteError] = useState(false);

  const pushRoute = useCallback((url: string): void => {
    window.history.pushState(null, "", url);
    setRouteError(false);
    setRoute(parseLocation());
  }, []);

  const replaceRoute = useCallback((url: string): void => {
    window.history.replaceState(null, "", url);
    setRouteError(false);
    setRoute(parseLocation());
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      setRouteError(false);
      setRoute(parseLocation());
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  return {
    route,
    routeError,
    setRouteError,
    pushRoute,
    replaceRoute,
  };
}

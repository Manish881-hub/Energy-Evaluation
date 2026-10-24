import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api.js";

export function useApi(path, params = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [nonce, setNonce] = useState(0);
  const key = JSON.stringify(params);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    setState((current) => ({ ...current, loading: true, error: null }));
    api(path, params)
      .then((data) => {
        if (mounted.current) setState({ data, error: null, loading: false });
      })
      .catch((error) => {
        if (mounted.current) setState({ data: null, error, loading: false });
      });
    return () => {
      mounted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, key, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);
  return { ...state, reload };
}

export function useUrlState(key, initialValue) {
  const [value, setValue] = useState(() => {
    if (typeof window === "undefined") return initialValue;
    const stored = new URLSearchParams(window.location.search).get(key);
    return stored ?? initialValue;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (value === "" || value === null || value === undefined) params.delete(key);
    else params.set(key, String(value));
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }, [key, value]);

  return [value, setValue];
}

export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false
  );
  useEffect(() => {
    const media = window.matchMedia(query);
    const listener = (event) => setMatches(event.matches);
    setMatches(media.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [query]);
  return matches;
}

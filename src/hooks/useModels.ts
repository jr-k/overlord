import { useEffect, useState } from "react";
import { AVAILABLE_MODELS, type ModelOption } from "../lib/models.js";

// Fetch model options from the backend. Aliases are resolved to concrete
// versions through the Claude CLI `system/init` event. Use the static list while
// the request is pending or when it fails.
export function useModels(): ModelOption[] {
  const [models, setModels] = useState<ModelOption[]>(AVAILABLE_MODELS);

  useEffect(() => {
    let alive = true;
    fetch("/api/models")
      .then((r) => r.json())
      .then((data) => {
        if (alive && Array.isArray(data) && data.length) setModels(data);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return models;
}

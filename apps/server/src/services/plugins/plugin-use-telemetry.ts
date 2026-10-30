import {
  deletePluginKvValue,
  getInstalledPlugin,
  getPluginKvValue,
  setPluginKvValue,
  type DbConnection,
  type InstalledPluginRow,
} from "@bb/db";
import { isPublicPluginProvenance } from "./plugin-registration.js";
import type { PluginServiceDeps } from "./plugin-service-internal.js";

const RECOMMENDATION_KEY = "@bb/recommendation";

type PluginUseTelemetryDeps = Pick<PluginServiceDeps, "db" | "telemetry">;

function isMeasurablePlugin(
  row: InstalledPluginRow | undefined,
): row is InstalledPluginRow {
  return (
    row?.enabled === true &&
    isPublicPluginProvenance(row.provenance, row.catalogMarketplaceName)
  );
}

export function rememberPluginRecommendation(
  deps: PluginUseTelemetryDeps,
  pluginId: string,
  recommendationId: string,
): void {
  if (deps.telemetry.isEnabled()) {
    setPluginKvValue(deps.db, pluginId, RECOMMENDATION_KEY, recommendationId);
  }
}

export function forgetPluginRecommendation(
  db: DbConnection,
  pluginId: string,
): void {
  deletePluginKvValue(db, pluginId, RECOMMENDATION_KEY);
}

export function capturePluginUse(
  deps: PluginUseTelemetryDeps,
  pluginId: string,
): void {
  if (
    !deps.telemetry.isEnabled() ||
    !isMeasurablePlugin(getInstalledPlugin(deps.db, pluginId))
  ) {
    return;
  }
  deps.telemetry.capture({
    name: "plugin_use",
    properties: { plugin_id: pluginId },
  });
  const recommendationId = getPluginKvValue(
    deps.db,
    pluginId,
    RECOMMENDATION_KEY,
  );
  if (recommendationId === undefined) return;
  forgetPluginRecommendation(deps.db, pluginId);
  deps.telemetry.capture({
    name: "recommendation",
    properties: {
      resource_type: "plugin",
      resource_id: pluginId,
      recommendation_id: recommendationId,
      action: "used",
    },
  });
}

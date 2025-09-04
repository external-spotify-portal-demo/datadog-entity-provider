// @ts-nocheck
// Example: Backend module for the new Backstage backend system
// Add this to your backend in packages/backend/src/index.ts

import { createBackend } from "@backstage/backend-defaults";
import {
  createBackendModule,
  coreServices,
  readSchedulerServiceTaskScheduleDefinitionFromConfig,
} from "@backstage/backend-plugin-api";
import { catalogProcessingExtensionPoint } from "@backstage/plugin-catalog-node/alpha";
import { DatadogServiceEntityProvider } from "./providers/DatadogServiceEntityProvider";

/**
 * Catalog backend module for the Datadog Software Catalog entity provider.
 *
 * @alpha
 */
export const catalogModuleDatadogServiceEntityProvider = createBackendModule({
  pluginId: "catalog",
  moduleId: "datadog-service-entity-provider",
  register(env) {
    env.registerInit({
      deps: {
        catalog: catalogProcessingExtensionPoint,
        config: coreServices.rootConfig,
        logger: coreServices.logger,
        scheduler: coreServices.scheduler,
      },
      async init({ catalog, config, logger, scheduler }) {
        logger.info("Initializing Datadog Software Catalog Entity Provider");
        const providerConfig = config.getConfig(
          "catalog.providers.datadog"
        );

        const schedule = providerConfig.has("schedule")
          ? readSchedulerServiceTaskScheduleDefinitionFromConfig(
              providerConfig.getConfig("schedule")
            )
          : {
              frequency: { minutes: 60 },
              timeout: { minutes: 50 },
            };
        catalog.addEntityProvider(
          DatadogServiceEntityProvider.fromConfig(config, {
            logger,
            schedule: scheduler.createScheduledTaskRunner(schedule),
          })
        );
      },
    });
  },
});

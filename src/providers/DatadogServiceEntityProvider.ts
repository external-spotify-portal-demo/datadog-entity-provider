import { Entity } from "@backstage/catalog-model";
import {
  EntityProvider,
  EntityProviderConnection,
} from "@backstage/plugin-catalog-node";
import { Config } from "@backstage/config";
import { Logger } from "winston";
import { SchedulerServiceTaskRunner } from "@backstage/backend-plugin-api";

export interface DatadogServiceEntityProviderConfig {
  apiKey: string;
  applicationKey: string;
  site?: string; // defaults to datadoghq.com
}

export class DatadogServiceEntityProvider implements EntityProvider {
  private readonly config: DatadogServiceEntityProviderConfig;
  private readonly logger: Logger;
  private readonly schedule: SchedulerServiceTaskRunner;
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private connection?: EntityProviderConnection;

  static fromConfig(
    config: Config,
    options: {
      logger: Logger;
      schedule: SchedulerServiceTaskRunner;
    }
  ): DatadogServiceEntityProvider {
    const providerConfig = config.getConfig("catalog.providers.datadog");

    const apiKey = providerConfig.getString("apiKey");
    const applicationKey = providerConfig.getString("applicationKey");
    const site = providerConfig.getOptionalString("site") || "datadoghq.com";

    return new DatadogServiceEntityProvider(
      {
        apiKey,
        applicationKey,
        site,
      },
      options
    );
  }

  constructor(
    config: DatadogServiceEntityProviderConfig,
    options: {
      logger: Logger;
      schedule: SchedulerServiceTaskRunner;
    }
  ) {
    this.config = config;
    this.logger = options.logger.child({
      target: this.getProviderName(),
    });
    this.schedule = options.schedule;

    // Initialize fetch configuration for Datadog API
    this.baseUrl = `https://api.${config.site}`;
    this.headers = {
      "DD-API-KEY": config.apiKey,
      "DD-APPLICATION-KEY": config.applicationKey,
      "Content-Type": "application/json",
    };

    this.logger.info("Datadog Service Entity Provider initialized");
  }

  getProviderName(): string {
    return `DatadogServiceEntityProvider`;
  }

  async connect(connection: EntityProviderConnection): Promise<void> {
    this.connection = connection;
    await this.schedule.run({
      id: this.getProviderName(),
      fn: async () => {
        await this.run();
      },
    });
  }

  async run(): Promise<void> {
    if (!this.connection) {
      throw new Error("Not initialized");
    }

    this.logger.info("Discovering entities from Datadog Software Catalog");

    try {
      const entities = await this.discoverServices();

      await this.connection.applyMutation({
        type: "full",
        entities: entities.map((entity) => ({
          entity,
          locationKey: this.getProviderName(),
        })),
      });

      this.logger.info(
        `Discovered ${entities.length} entities from Datadog Software Catalog`
      );
    } catch (error) {
      this.logger.error(
        "Failed to discover entities from Datadog Software Catalog",
        error
      );
      throw error;
    }
  }

  private async discoverServices(): Promise<Entity[]> {
    try {
      // Paginate through all entities in the Datadog Software Catalog API
      const backstageEntities: Entity[] = [];
      let offset = 0;
      const limit = 100; // Datadog default/max page size
      let hasNext = true;

      while (hasNext) {
        const url = `${this.baseUrl}/api/v2/catalog/entity?include=schema&page[limit]=${limit}&page[offset]=${offset}`;
        const response = await fetch(url, {
          method: "GET",
          headers: this.headers,
        });

        if (!response.ok) {
          const errorText = await response.text();
          this.logger.error(
            `Datadog API request failed: ${response.status} ${response.statusText}`,
            errorText
          );
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        if (!data || !data.data) {
          this.logger.warn(
            "No entity data returned from Datadog Software Catalog API"
          );
          break;
        }

        const catalogEntities = data.data;
        this.logger.info(
          `Fetched ${catalogEntities.length} entities from Datadog Software Catalog (offset ${offset})`
        );

        for (const catalogEntity of catalogEntities) {
          try {
            const entity = this.createServiceEntity(catalogEntity);
            if (entity) {
              backstageEntities.push(entity);
            }
          } catch (error) {
            this.logger.warn(
              `Failed to create entity for service ${
                catalogEntity.attributes?.name || "unknown"
              }`,
              error
            );
          }
        }

        // Check for next page
        if (
          data.links &&
          typeof data.links.next === "string" &&
          data.links.next.includes("page%5Boffset%5D=")
        ) {
          // Extract next offset from the next link
          const match = data.links.next.match(/page%5Boffset%5D=(\d+)/);
          if (match && match[1]) {
            offset = parseInt(match[1], 10);
            hasNext = true;
          } else {
            hasNext = false;
          }
        } else {
          hasNext = false;
        }
      }

      return backstageEntities;
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(
          `Failed to fetch entities from Datadog Software Catalog: ${error.message}`,
          error
        );
      } else {
        this.logger.error(
          "Failed to fetch entities from Datadog Software Catalog",
          error
        );
      }
      throw error;
    }
  }

  private createServiceEntity(service: any): Entity | null {
    const attributes = service.attributes;
    if (!attributes || !attributes.name) {
      this.logger.debug("Skipping service without name or attributes");
      return null;
    }

    // Clean the name to make it compatible with Backstage
    const name = attributes.name.toLowerCase().replace(/[^a-z0-9-]/g, "-");

    // Extract owner information
    const owner =
      attributes.owner ||
      attributes.contacts?.find((contact: any) => contact.type === "squad")
        ?.contact ||
      attributes.contacts?.find((contact: any) => contact.type === "team")
        ?.contact ||
      "unknown";

    // Extract repository information if available
    const repos = attributes.repos || [];
    const primaryRepo =
      repos.find((repo: any) => repo.provider === "github") || repos[0];

    // Extract relationships using a helper function
    const relationships = this.extractRelationships(service); // tood: add to spec
    console.log(relationships);

    const entity: Entity = {
      apiVersion: "backstage.io/v1alpha1",
      kind: attributes.kind === "system" ? "System" : "Component",
      metadata: {
        name,
        title: attributes.name,
        description:
          attributes.description ||
          `Service ${attributes.name} from Datadog catalog`,
        annotations: {
          "datadoghq.com/service-name": attributes.name,
          "backstage.io/managed-by-location": `datadog:${this.config.site}`,
          "backstage.io/managed-by-origin-location": `datadog:${this.config.site}`,
        },
        tags: [
          "datadog",
          ...(attributes.tags || []),
          ...(attributes.tier ? [`tier-${attributes.tier}`] : []),
        ],
        links: [],
      },
      spec: {
        type: attributes.kind || "service",
        lifecycle: attributes.lifecycle || "unknown",
        owner,
      },
    };

    // Add repository link if available
    if (primaryRepo && primaryRepo.url) {
      entity.metadata.annotations![
        "backstage.io/source-location"
      ] = `url:${primaryRepo.url}/`;
      entity.metadata.links!.push({
        url: primaryRepo.url,
        title: "Repository",
        icon: "code",
      });
    }

    // Add team information if available
    if (attributes.team) {
      entity.metadata.annotations!["datadoghq.com/team"] = attributes.team;
    }

    // Add application information if available
    if (attributes.application) {
      entity.metadata.annotations!["datadoghq.com/application"] =
        attributes.application;
    }

    return entity;
  }

  private extractRelationships(service: any): any[] {
    // Extract relationships from dd_catalog.json and model them into Backstage spec for relations

    // If there are no relationships, return empty array
    if (!service.relationships || !service.relationships.relatedEntities) {
      return [];
    }

    // Map Datadog relationship types to Backstage relation types
    const ddToBackstageRelationType: Record<string, string> = {
      RelationTypeDependsOn: "dependsOn",
      RelationTypeDependencyOf: "dependencyOf",
      RelationTypeOwnedBy: "ownedBy",
      RelationTypeOwnerOf: "ownerOf",
      RelationTypePartsOf: "partOf",
      RelationTypeHasPart: "hasPart",
    };

    // Build Backstage relations array
    const relations: any[] = [];

    for (const rel of service.relationships.relatedEntities.data) {
      // rel.id example: "frontend:default/music-player-app:RelationTypeDependsOn:service:default/music-player-service"
      const idParts: string[] = rel.id.split(":");
      const relTypePart = idParts.find((p) => p.startsWith("RelationType"));
      if (!relTypePart) continue;
      const backstageType = ddToBackstageRelationType[relTypePart];
      if (!backstageType) continue;

      const target = this.parseDdEntityRef(rel.id);
      if (!target) continue;

      relations.push({
        type: backstageType,
        target: this.toEntityRef(target),
      });
    }

    return relations;
  }
  // Helper to parse a Datadog relationship id into Backstage entityRef
  private parseDdEntityRef(
    id: string
  ): { kind: string; namespace: string; name: string } | null {
    // Example id: "frontend:default/music-player-app:RelationTypeDependsOn:service:default/music-player-service"
    const parts = id.split(":");
    // Find the index of the relation type
    const relTypeIdx = parts.findIndex((p) => p.startsWith("RelationType"));
    if (
      relTypeIdx === -1 ||
      relTypeIdx === 0 ||
      relTypeIdx === parts.length - 1
    ) {
      return null;
    }
    // The target entity is after the relation type
    const kind = parts[relTypeIdx + 1];
    const namespace = parts[relTypeIdx + 2];
    const name = parts[relTypeIdx + 3];
    if (!kind || !namespace || !name) return null;
    return { kind, namespace, name };
  }

  // Compose Backstage entityRef string
  private toEntityRef({
    kind,
    namespace,
    name,
  }: {
    kind: string;
    namespace: string;
    name: string;
  }) {
    return `${kind.toLocaleLowerCase()}:${namespace}/${name}`;
  }
}

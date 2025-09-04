/*
 * Copyright 2020 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { SchedulerServiceTaskScheduleDefinitionConfig } from '@backstage/backend-plugin-api';

export interface Config {
  catalog?: {
    providers?: {
      datadog?: {
        /**
         * Datadog API Key for authentication
         * @visibility secret
         */
        apiKey: string;
        /**
         * Datadog Application Key for authentication
         * @visibility secret
         */
        applicationKey: string;
        /**
         * Datadog site URL (optional, defaults to datadoghq.com)
         * @visibility frontend
         */
        site?: string;
        /**
         * Schedule configuration (optional - can be provided via backend integration)
         * @visibility frontend
         */
        schedule?: SchedulerServiceTaskScheduleDefinitionConfig;
      };
    };
  };
} 
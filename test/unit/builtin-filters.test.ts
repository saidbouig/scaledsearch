import { describe, it, expect } from 'vitest';
import {
  isBuiltinIndex,
  isBuiltinPipeline,
  isBuiltinTemplate,
} from '../../src/engine/builtin-filters';

describe('isBuiltinIndex', () => {
  it('excludes leading-dot system indices', () => {
    expect(isBuiltinIndex('.kibana')).toBe(true);
    expect(isBuiltinIndex('.security')).toBe(true);
    expect(isBuiltinIndex('.fleet-files')).toBe(true);
  });

  it('excludes OpenSearch plugin auto-created indices', () => {
    expect(isBuiltinIndex('top_queries-2026.06.04-14688')).toBe(true);
    expect(isBuiltinIndex('.opensearch-observability')).toBe(true);
    expect(isBuiltinIndex('.opendistro-anomaly-detector-jobs')).toBe(true);
    expect(isBuiltinIndex('.plugins-ml-config')).toBe(true);
    expect(isBuiltinIndex('.tasks')).toBe(true);
  });

  it('keeps user-named indices', () => {
    expect(isBuiltinIndex('users')).toBe(false);
    expect(isBuiltinIndex('orders_v2')).toBe(false);
    expect(isBuiltinIndex('simplewiki')).toBe(false);
    expect(isBuiltinIndex('logs-2025-01')).toBe(false); // user-named logs index, not built-in
  });

  it('does not exclude indices that merely contain top_queries as substring', () => {
    expect(isBuiltinIndex('user_top_queries')).toBe(false);
  });
});

describe('isBuiltinTemplate', () => {
  it('excludes leading-dot templates', () => {
    expect(isBuiltinTemplate('.kibana-reporting')).toBe(true);
    expect(isBuiltinTemplate('.fleet-fileds-fromhost-data')).toBe(true);
    expect(isBuiltinTemplate('.monitoring-es-mb')).toBe(true);
    expect(isBuiltinTemplate('.deprecation-indexing-template')).toBe(true);
    expect(isBuiltinTemplate('.slm-history-7')).toBe(true);
    expect(isBuiltinTemplate('.watch-history-17')).toBe(true);
    expect(isBuiltinTemplate('.ml-state')).toBe(true);
  });

  it('excludes @template / @pipeline / @default-pipeline suffix patterns', () => {
    expect(isBuiltinTemplate('logs-apm.app@template')).toBe(true);
    expect(isBuiltinTemplate('metrics-apm.service_summary.10m@template')).toBe(true);
    expect(isBuiltinTemplate('apm@pipeline')).toBe(true);
    expect(isBuiltinTemplate('logs-apm.app@default-pipeline')).toBe(true);
  });

  it('excludes bare logs/metrics/traces composable templates', () => {
    expect(isBuiltinTemplate('logs')).toBe(true);
    expect(isBuiltinTemplate('metrics')).toBe(true);
    expect(isBuiltinTemplate('traces')).toBe(true);
    expect(isBuiltinTemplate('synthetics')).toBe(true);
  });

  it('excludes APM-prefixed templates', () => {
    expect(isBuiltinTemplate('logs-apm.error')).toBe(true);
    expect(isBuiltinTemplate('metrics-apm.internal')).toBe(true);
    expect(isBuiltinTemplate('traces-apm.rum')).toBe(true);
  });

  it('excludes ILM/SLM history, watcher, behavioral analytics, connectors', () => {
    expect(isBuiltinTemplate('ilm-history-7')).toBe(true);
    expect(isBuiltinTemplate('slm-history-7')).toBe(true);
    expect(isBuiltinTemplate('watch-history-17')).toBe(true);
    expect(isBuiltinTemplate('behavioral_analytics-events-default')).toBe(true);
    expect(isBuiltinTemplate('elastic-connectors')).toBe(true);
    expect(isBuiltinTemplate('elastic-connectors-sync-jobs')).toBe(true);
    expect(isBuiltinTemplate('agentless')).toBe(true);
  });

  it('excludes ES 9 built-ins surfaced during real-cluster testing', () => {
    expect(isBuiltinTemplate('search-acl-filter')).toBe(true);
    expect(isBuiltinPipeline('logs-default-pipeline')).toBe(true);
  });

  it('keeps user-named templates', () => {
    expect(isBuiltinTemplate('imp_test_tpl')).toBe(false);
    expect(isBuiltinTemplate('my_app_template')).toBe(false);
    expect(isBuiltinTemplate('user-logs-template')).toBe(false);
    expect(isBuiltinTemplate('orders_index_template')).toBe(false);
  });

  it('keeps templates whose names happen to contain "logs" but as part of a longer name', () => {
    expect(isBuiltinTemplate('my_logs_template')).toBe(false);
    expect(isBuiltinTemplate('order_logs')).toBe(false);
  });
});

describe('isBuiltinPipeline', () => {
  it('excludes the same patterns as templates', () => {
    expect(isBuiltinPipeline('apm@pipeline')).toBe(true);
    expect(isBuiltinPipeline('logs-apm.app@default-pipeline')).toBe(true);
    expect(isBuiltinPipeline('logs@default-pipeline')).toBe(true);
    expect(isBuiltinPipeline('logs@json-message')).toBe(true);
    expect(isBuiltinPipeline('logs@json-pipeline')).toBe(true);
    expect(isBuiltinPipeline('reindex-data-stream-pipeline')).toBe(true);
    expect(isBuiltinPipeline('search-default-ingestion')).toBe(true);
  });

  it('keeps user-named pipelines', () => {
    expect(isBuiltinPipeline('imp_test_pipe')).toBe(false);
    expect(isBuiltinPipeline('enrich_orders')).toBe(false);
    expect(isBuiltinPipeline('my_ingest')).toBe(false);
  });
});

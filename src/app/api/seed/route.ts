import { NextResponse } from 'next/server';
import { query } from '@/lib/cockroachdb';
import { generateEmbedding, storeEmbedding } from '@/lib/agents';

const RUNBOOKS = [
  {
    title: 'Database Connection Pool Exhaustion',
    category: 'database',
    content: 'When the database connection pool is exhausted, follow these steps:\n1. Check the connection pool metrics in the monitoring dashboard\n2. Identify which service is consuming the most connections\n3. If it is a leak, restart the affected service after applying connection limits\n4. Increase pool size temporarily if traffic spike is expected\n5. Review connection timeout settings and adjust idle timeout to 30s\n6. Enable connection pool monitoring alerts at 80% capacity\n7. Post-incident: implement circuit breaker pattern for database connections',
  },
  {
    title: 'High CPU Utilization on API Servers',
    category: 'infrastructure',
    content: 'Response protocol for high CPU on API servers:\n1. Verify it is not a scheduled job or known batch process\n2. Check if auto-scaling is triggered and if not, why\n3. Identify top CPU-consuming processes\n4. If caused by a specific endpoint, enable rate limiting\n5. Scale horizontally by adding more instances\n6. If caused by a memory leak, restart instances and file a bug\n7. Review recent deployments for regressions\n8. Enable CPU-based auto-scaling if not already configured',
  },
  {
    title: 'Payment Processing Failures',
    category: 'business-critical',
    content: 'Payment processing failure response:\n1. Check the payment gateway status page for outages\n2. Verify API credentials have not expired or rotated\n3. Check for recent changes to payment request payloads\n4. Review error logs for specific error codes from the gateway\n5. Enable fallback payment processor if configured\n6. Queue failed transactions for retry once the issue is resolved\n7. Notify the finance team of potential revenue impact\n8. Test with a sandbox payment to isolate the issue',
  },
  {
    title: 'SSL Certificate Expiration',
    category: 'security',
    content: 'SSL certificate expiration protocol:\n1. Identify which domains/certificates are expiring\n2. If already expired, request emergency certificate reissuance\n3. Check if auto-renewal is configured and why it failed\n4. Deploy new certificates using the established CI/CD pipeline\n5. Verify certificate chain is complete (leaf, intermediate, root)\n6. Test SSL using external tools like SSL Labs\n7. Set up monitoring for certificate expiration (alert at 30, 14, 7 days)\n8. Document the certificate authority and account used for renewal',
  },
  {
    title: 'Kubernetes Pod CrashLoopBackOff',
    category: 'infrastructure',
    content: 'Troubleshooting Pod CrashLoopBackOff:\n1. Describe the pod to see recent events and error messages\n2. Check pod logs for application-level errors\n3. Verify resource limits are not causing OOMKills\n4. Check if the container image is valid and accessible\n5. Verify ConfigMaps and Secrets are mounted correctly\n6. Check for failed readiness/liveness probe configurations\n7. If caused by a dependency, check if the dependent service is healthy\n8. Scale down and up to force a fresh pod schedule\n9. Review recent changes to Deployment or StatefulSet specs',
  },
  {
    title: 'Memory Leak Detection and Response',
    category: 'performance',
    content: 'Memory leak detection and response protocol:\n1. Confirm memory leak by monitoring memory usage over time\n2. Take a heap dump from the affected process\n3. Analyze the heap dump to identify objects consuming the most memory\n4. Check for common patterns: unclosed connections, event listener accumulation, cache without eviction\n5. If critical, restart the service immediately to restore functionality\n6. Implement memory profiling in staging environment\n7. Add memory-based alerts at 85% of heap limit\n8. Fix the root cause and deploy with monitoring',
  },
  {
    title: 'API Rate Limiting Breach',
    category: 'security',
    content: 'Response to API rate limiting breach:\n1. Identify the client or IP address exceeding rate limits\n2. Determine if it is legitimate traffic or a potential attack\n3. If attack, implement IP blocking at the WAF level\n4. If legitimate traffic, increase rate limits for that client\n5. Review rate limiting configuration for appropriateness\n6. Enable more granular rate limiting per endpoint\n7. Implement backoff and retry guidance in API responses\n8. Notify the client about their usage patterns',
  },
  {
    title: 'Data Replication Lag',
    category: 'database',
    content: 'Data replication lag resolution:\n1. Check replication lag metrics across all replicas\n2. Identify if lag is on read replicas or across the cluster\n3. Check for long-running transactions on the primary\n4. Verify network connectivity between primary and replicas\n5. Check disk I/O on replicas for bottlenecks\n6. If caused by heavy read queries, consider read splitting\n7. Temporarily redirect read traffic away from lagging replicas\n8. Review and optimize slow queries causing replication pressure',
  },
];

const PAST_INCIDENTS = [
  {
    title: 'Production Database Connection Pool Exhaustion',
    description: 'The production PostgreSQL connection pool reached maximum capacity at 14:32 UTC. The API server started returning 503 errors to approximately 23% of requests. The issue was traced to a recently deployed microservice that was not properly closing database connections after each request, creating a connection leak that exhausted the pool over 4 hours.',
    severity: 'high',
    source: 'pagerduty',
    agent_notes: 'Root cause: connection leak in user-service v2.3.1. Fix: deployed v2.3.2 with proper connection cleanup. Added connection pool monitoring.',
    resolution_summary: 'Deployed hotfix v2.3.2 to user-service that properly closes database connections. Increased pool max from 50 to 100. Added Prometheus alerts at 80% pool utilization.',
    status: 'resolved',
  },
  {
    title: 'Payment Gateway 502 Errors During Peak Hours',
    description: 'Starting at 09:00 UTC during peak checkout hours, approximately 15% of payment attempts failed with 502 Bad Gateway errors from our payment processor. The payment gateway confirmed an outage on their US-East region. Estimated revenue impact of approximately $45,000 per hour of downtime.',
    severity: 'critical',
    source: 'monitoring',
    agent_notes: 'Root cause: payment gateway regional outage. Failover to EU region completed at 09:47 UTC.',
    resolution_summary: 'Activated fallback payment processor (Stripe EU region) within 47 minutes. Queued 1,247 failed transactions for automatic retry. All queued transactions completed successfully within 2 hours.',
    status: 'resolved',
  },
  {
    title: 'Kubernetes Cluster Node Failure',
    description: 'Two worker nodes in the us-east-1 Kubernetes cluster became unresponsive at 22:15 UTC. Pods running on those nodes entered Pending state and were not rescheduled due to PDB (Pod Disruption Budget) constraints. Approximately 30% of API capacity was lost.',
    severity: 'high',
    source: 'cloudwatch',
    agent_notes: 'Root cause: hardware failure on underlying EC2 instances. ASG replaced nodes within 15 minutes but pod scheduling was delayed by PDB.',
    resolution_summary: 'AWS ASG detected node failure and launched replacement instances. Manually deleted stuck pods to force rescheduling. Reviewed and relaxed PDB constraints for stateless services. All services restored by 22:45 UTC.',
    status: 'resolved',
  },
  {
    title: 'SSL Certificate Expired for api.example.com',
    description: 'The SSL certificate for api.example.com expired at midnight UTC. All HTTPS requests to the API started failing with certificate validation errors. Mobile apps, web clients, and third-party integrations were all affected. The certificate had been set to auto-renew via Let\'s Encrypt but the renewal job had failed silently due to a DNS configuration change.',
    severity: 'critical',
    source: 'external_report',
    agent_notes: 'Root cause: Let\'s Encrypt DNS challenge failed due to CNAME record change 30 days ago. Auto-renewal cron job logged errors but no alert was configured.',
    resolution_summary: 'Manually triggered certificate renewal with corrected DNS configuration. Deployed new certificate via CI/CD pipeline. Set up multi-layer monitoring: certificate expiry alerts at 30/14/7 days, renewal job success/failure alerts, and SSL Labs monitoring.',
    status: 'resolved',
  },
  {
    title: 'Memory Leak in Order Processing Service',
    description: 'The order processing service showed steadily increasing memory usage over 48 hours, eventually causing OOMKill events every 2-3 hours. Each restart restored normal operation for approximately 6-8 hours before memory growth resumed. The service processes an average of 10,000 orders per hour during business hours.',
    severity: 'medium',
    source: 'monitoring',
    agent_notes: 'Root cause: event listeners in the order event bus were not being cleaned up after processing, causing a memory leak that grew proportionally to order volume.',
    resolution_summary: 'Identified the event listener accumulation through heap dump analysis. Deployed fix that properly removes listeners after event processing. Added memory profiling endpoint. Memory usage stabilized at 45% of allocated heap.',
    status: 'resolved',
  },
];

export async function POST() {
  try {
    // Insert runbooks with embeddings
    for (const rb of RUNBOOKS) {
      const embedding = generateEmbedding(`${rb.title} ${rb.content}`);
      const vecStr = `[${embedding.join(',')}]`;
      await query(
        `INSERT INTO runbooks (title, content, category, embedding) VALUES ($1, $2, $3, $4:::vector)`,
        [rb.title, rb.content, rb.category, vecStr]
      );
    }
    console.log(`Seeded ${RUNBOOKS.length} runbooks`);

    // Insert past incidents with embeddings
    const incidentIds: string[] = [];
    for (const inc of PAST_INCIDENTS) {
      const created_at = new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString();
      const resolved_at = new Date(new Date(created_at).getTime() + Math.random() * 4 * 60 * 60 * 1000).toISOString();

      const result = await query(
        `INSERT INTO incidents (title, description, severity, status, source, agent_notes, resolution_summary, created_at, updated_at, resolved_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [inc.title, inc.description, inc.severity, inc.status, inc.source, inc.agent_notes, inc.resolution_summary, created_at, created_at, resolved_at]
      );
      incidentIds.push(result.rows[0].id as string);

      // Store embeddings for RAG
      await storeEmbedding(result.rows[0].id as string, `${inc.title} ${inc.description}`, 'description');
      if (inc.resolution_summary) {
        await storeEmbedding(result.rows[0].id as string, `Resolution: ${inc.resolution_summary}`, 'resolution');
      }
    }
    console.log(`Seeded ${PAST_INCIDENTS.length} incidents with embeddings`);

    return NextResponse.json({
      success: true,
      runbooksSeeded: RUNBOOKS.length,
      incidentsSeeded: PAST_INCIDENTS.length,
    });
  } catch (error) {
    console.error('Seed error:', error);
    return NextResponse.json({ error: 'Seed failed', details: String(error) }, { status: 500 });
  }
}
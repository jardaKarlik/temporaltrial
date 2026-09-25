import { Client } from '@temporalio/client';
import { releaseListWorkflow, approvalSignal } from './workflows.js';
import { NativeConnection } from '@temporalio/worker';
import { loadTeknoConfig } from './config.js';
import * as dotenv from 'dotenv';

dotenv.config();

async function run() {
  const { temporalAddress } = loadTeknoConfig();
  
  // Create a connection to the Temporal service
  const connection = await NativeConnection.connect({
    address: temporalAddress,
  });

  // Create a client connected to the Temporal service
  const client = new Client({
    connection,
  });

  // Define a sample release request
  const releaseRequest = {
    version: '1.2.3',
    changelog: '## Features\n- Added new user dashboard\n- Improved API response times\n## Bug Fixes\n- Fixed login issue on Safari\n- Resolved memory leak in data processing\n## Performance\n- Optimized database queries\n- Reduced bundle size by 15%',
    requestedBy: 'release-manager@tekno.example.com',
    metadata: {
      commitHash: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0',
      branch: 'main',
      pullRequestId: 42
    }
  };

  console.log('Starting Release List Workflow...');
  console.log(`Release Request: v${releaseRequest.version} by ${releaseRequest.requestedBy}`);

  // Start a workflow execution
  const handle = await client.workflow.start(releaseListWorkflow, {
    // Task queue must match what the worker is listening to
    taskQueue: 'release-list-task-queue',
    // Unique identifier for this workflow execution
    workflowId: `release-list-${releaseRequest.version}-${Date.now()}`,
    // Arguments to pass to the workflow
    args: [releaseRequest],
  });

  console.log(`Started workflow ${handle.workflowId}`);
  console.log(`Run ID: ${handle.firstExecutionRunId}`);

  // In a real scenario, we might want to send an approval signal after some time
  // For demo purposes, we'll wait for the workflow to complete (which will timeout on approval)
  // Or we could send an approval signal automatically after a short delay
  
  // Let's send an approval signal after 10 seconds to demonstrate the signaling capability
  setTimeout(async () => {
    try {
      console.log('Sending approval signal...');
      // Corrected: use handle.signal, not client.workflow.signal
      await handle.signal(approvalSignal, {
        approved: true,
        approvedBy: 'demo-approver',
        comments: 'Auto-approved for demo'
      });
      console.log('Approval signal sent');
    } catch (signalError) {
      console.error('Failed to send approval signal:', signalError);
    }
  }, 10000); // 10 seconds

  // Wait for the workflow to complete and get the result
  const result = await handle.result();
  console.log('Workflow Completed!');
  console.log('Result:', JSON.stringify(result, null, 2));

  // Close the connection
  await connection.close();
}

run().catch((err) => {
  console.error('Failed to start workflow:', err);
  process.exit(1);
});
import { Worker, NativeConnection } from '@temporalio/worker';
import * as activities from './activities.js';
import { loadTeknoConfig } from './config.js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  const cfg = loadTeknoConfig();
  const temporalAddress = cfg.temporalAddress;

  // Create a connection to the Temporal service
  const connection = await NativeConnection.connect({
    address: temporalAddress,
  });

  // Create a worker that will process tasks from the task queue
  const worker = await Worker.create({
    connection,
    taskQueue: 'tekno-release-task-queue',
    // Point to the directory containing workflow functions
    workflowsPath: path.resolve(__dirname, '..', 'src'),
    // Explicitly register activities
    activities: {
      validateReleaseActivity: activities.validateReleaseActivity,
      buildAppActivity: activities.buildAppActivity,
      runTestsActivity: activities.runTestsActivity,
      deployToStagingActivity: activities.deployToStagingActivity,
      deployToProductionActivity: activities.deployToProductionActivity,
      postDeploymentChecksActivity: activities.postDeploymentChecksActivity,
      notifyStakeholdersActivity: activities.notifyStakeholdersActivity
    },
  });

  // Listen for shutdown signals
  const shutdown = async () => {
    console.log('Shutting down worker...');
    await worker.shutdown();
    await connection.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Run the worker
  await worker.run();
  console.log('Worker started successfully for Tekno Release workflow');
}

run().catch((err) => {
  console.error('Worker failed to start:', err);
  process.exit(1);
});
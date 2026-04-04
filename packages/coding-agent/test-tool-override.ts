/**
 * Test script to verify tool override functionality
 */

import { createAgentSession } from './dist/index.js';
import type { ToolDefinition } from './dist/core/extensions/types.js';

async function main() {
    console.log('=== Testing Tool Override Functionality ===\n');
    
    const session = await createAgentSession({
        cwd: process.cwd(),
        extensionPaths: ['/tmp/test-tool-override'],
        headless: true
    });

    // Get all registered tools
    const tools = session.getAllTools();
    
    console.log('Total tools registered:', tools.size);
    console.log('\n--- Checking overridden tools ---\n');
    
    // Check if 'read' tool is overridden
    const readTool = tools.get('read');
    if (readTool) {
        console.log('✓ read tool found');
        console.log('  Description:', readTool.definition.description);
        console.log('  Source:', readTool.sourceInfo?.source || 'unknown');
    } else {
        console.log('✗ read tool NOT found');
    }
    
    console.log();
    
    // Check if 'bash' tool is overridden
    const bashTool = tools.get('bash');
    if (bashTool) {
        console.log('✓ bash tool found');
        console.log('  Description:', bashTool.definition.description);
        console.log('  Source:', bashTool.sourceInfo?.source || 'unknown');
    } else {
        console.log('✗ bash tool NOT found');
    }
    
    console.log();
    
    // Check if 'custom_test' tool exists
    const customTool = tools.get('custom_test');
    if (customTool) {
        console.log('✓ custom_test tool found');
        console.log('  Description:', customTool.definition.description);
        console.log('  Source:', customTool.sourceInfo?.source || 'unknown');
    } else {
        console.log('✗ custom_test tool NOT found');
    }
    
    console.log('\n--- Summary ---');
    console.log('Expected behavior:');
    console.log('  - read tool should be from extension (override)');
    console.log('  - bash tool should be from extension (override)');
    console.log('  - custom_test tool should be from extension (new)');
    
    await session.shutdown();
    console.log('\n✓ Test completed successfully');
}

main().catch(console.error);

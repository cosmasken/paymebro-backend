#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function getCurrentSchema() {
  try {
    console.log('🔍 Fetching current Supabase database schema...\n');

    // Use direct SQL query to get tables
    const { data: tables, error: tablesError } = await supabase.rpc('get_schema_info');
    
    if (tablesError) {
      console.log('RPC function not available, trying direct table queries...\n');
      
      // Try to get tables by querying known tables directly
      const knownTables = ['users', 'payments', 'payment_templates', 'subscriptions', 'subscription_plans', 'webhooks'];
      
      console.log('📋 CHECKING KNOWN TABLES:');
      console.log('='.repeat(50));
      
      for (const tableName of knownTables) {
        console.log(`\n🔸 ${tableName.toUpperCase()}`);
        
        try {
          // Try to get one record to see table structure
          const { data: sampleData, error: sampleError } = await supabase
            .from(tableName)
            .select('*')
            .limit(1);

          if (sampleError) {
            console.log(`  ❌ Table not found or error: ${sampleError.message}`);
          } else {
            console.log(`  ✅ Table exists`);
            if (sampleData && sampleData.length > 0) {
              console.log('  📝 Sample record structure:');
              Object.keys(sampleData[0]).forEach(key => {
                const value = sampleData[0][key];
                const type = typeof value;
                const displayValue = value === null ? 'null' : 
                                   type === 'string' && value.length > 50 ? `"${value.substring(0, 50)}..."` :
                                   JSON.stringify(value);
                console.log(`    ${key}: ${type} = ${displayValue}`);
              });
            } else {
              console.log('  📝 Table is empty');
            }
          }
        } catch (err) {
          console.log(`  ❌ Error accessing table: ${err.message}`);
        }
      }

      // Generate TypeScript interfaces based on sample data
      console.log('\n\n🔧 GENERATED TYPESCRIPT INTERFACES:');
      console.log('='.repeat(50));

      for (const tableName of knownTables) {
        try {
          const { data: sampleData } = await supabase
            .from(tableName)
            .select('*')
            .limit(1);

          if (sampleData && sampleData.length > 0) {
            const interfaceName = tableName
              .split('_')
              .map(word => word.charAt(0).toUpperCase() + word.slice(1))
              .join('');

            console.log(`\ninterface ${interfaceName} {`);
            
            Object.keys(sampleData[0]).forEach(key => {
              const value = sampleData[0][key];
              const tsType = inferTypeScriptType(value);
              console.log(`  ${key}: ${tsType};`);
            });
            
            console.log('}');
          }
        } catch (err) {
          // Skip tables that don't exist
        }
      }

      return;
    }

    // If RPC worked, process the results
    console.log('📋 TABLES FROM RPC:');
    console.log('='.repeat(50));
    console.log(tables);

  } catch (error) {
    console.error('❌ Error fetching schema:', error);
  }
}

function inferTypeScriptType(value) {
  if (value === null) return 'string | null';
  
  const jsType = typeof value;
  
  switch (jsType) {
    case 'string':
      // Check if it looks like a UUID
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
        return 'string'; // UUID
      }
      // Check if it looks like a timestamp
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
        return 'string'; // ISO timestamp
      }
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'object':
      if (Array.isArray(value)) {
        return 'any[]';
      }
      return 'any';
    default:
      return 'any';
  }
}

// Run the script
getCurrentSchema().then(() => {
  console.log('\n✅ Schema fetch complete!');
  process.exit(0);
}).catch(error => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});

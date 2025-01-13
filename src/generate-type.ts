const { PGlite } = require('@electric-sql/pglite');
import { writeFile } from 'fs/promises';  // Use async version of fs

async function generateTypes() {
  // Initialize pg-lite with an in-memory SQLite database
  const dbClient = new PGlite({
    database: ':memory:',  // Using an in-memory database
  });

  // Create the table (replace with your actual table schema)
  await dbClient.query(`
    CREATE TABLE student (
      name TEXT,
      rollno INTEGER
    );
  `);

  // Insert some example data (optional)
  await dbClient.query(`
    INSERT INTO student (name, rollno)
    VALUES ('seve', 42);
  `);

  // Query schema (adjust according to your table structure)
  const schema = await dbClient.query('SELECT * FROM student LIMIT 1');
  console.log('Fetched schema:', schema);

  // Generate TypeScript types based on the schema
  const types = `// Generated Types
type YourTable = {
  name: string;
  rollno: number;
};`;

  try {
    // Write the generated types to a file (types.d.ts)
    await writeFile('./src/types.d.ts', types);
    console.log('Types generated and saved to types.d.ts');
  } catch (err) {
    console.error('Error writing to file:', err);
  }
}

generateTypes().catch(err => {
  console.error('Error generating types:', err);
});

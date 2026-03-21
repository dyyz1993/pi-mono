#!/usr/bin/env node

import { execSync } from 'child_process'
import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { resolve, relative, dirname, basename, join } from 'path'

interface TestFile {
  path: string
  dependencies: Set<string>
}

interface ChangedFiles {
  added: string[]
  modified: string[]
  deleted: string[]
}

const PROJECT_ROOT = process.cwd()

function findTestFiles(): string[] {
  const testFiles: string[] = []

  function scanDir(dir: string) {
    try {
      const items = readdirSync(dir)

      for (const item of items) {
        const fullPath = join(dir, item)

        if (item === 'node_modules' || item === 'dist' || item === '.git') continue

        try {
          const stat = statSync(fullPath)

          if (stat.isDirectory()) {
            scanDir(fullPath)
          } else if (stat.isFile()) {
            if (item.includes('.test.') || item.includes('.spec.')) {
              if (item.endsWith('.ts') || item.endsWith('.tsx')) {
                testFiles.push(relative(PROJECT_ROOT, fullPath))
              }
            }
          }
        } catch (error) {}
      }
    } catch (error) {}
  }

  scanDir(PROJECT_ROOT)
  return testFiles
}

function getChangedFiles(): ChangedFiles {
  try {
    const isStaged = process.argv.includes('--staged')

    let diffCommand: string
    if (isStaged) {
      diffCommand = 'git diff --cached --name-status'
    } else {
      diffCommand = 'git diff HEAD --name-status'
    }

    const output = execSync(diffCommand, { encoding: 'utf-8' })
    const lines = output.trim().split('\n').filter(Boolean)

    const changed: ChangedFiles = {
      added: [],
      modified: [],
      deleted: [],
    }

    for (const line of lines) {
      const [status, ...paths] = line.split(/\s+/)
      const filePath = paths[0]

      if (!filePath) continue

      switch (status) {
        case 'A':
          changed.added.push(filePath)
          break
        case 'M':
        case 'R':
          changed.modified.push(filePath)
          break
        case 'D':
          changed.deleted.push(filePath)
          break
      }
    }

    return changed
  } catch (error) {
    console.log('No changes detected or not in a git repository')
    return { added: [], modified: [], deleted: [] }
  }
}

function extractImports(filePath: string): string[] {
  try {
    if (!existsSync(filePath)) return []

    const content = readFileSync(filePath, 'utf-8')
    const imports: string[] = []

    const importRegex = /import\s+.*?from\s+['"]([^'"]+)['"]/g
    let match

    while ((match = importRegex.exec(content)) !== null) {
      const importPath = match[1]

      if (importPath.startsWith('.')) {
        const resolvedPath = resolve(dirname(filePath), importPath)
        imports.push(resolvedPath)
      } else if (
        importPath.startsWith('@shared/') ||
        importPath.startsWith('@client/') ||
        importPath.startsWith('@server/')
      ) {
        const aliasPath = importPath
          .replace('@shared/', 'src/shared/')
          .replace('@client/', 'src/client/')
          .replace('@server/', 'src/server/')
        imports.push(resolve(PROJECT_ROOT, aliasPath))
      }
    }

    return imports
  } catch (error) {
    return []
  }
}

function buildDependencyGraph(testFiles: string[]): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>()

  function getDependencies(filePath: string, visited: Set<string>): Set<string> {
    if (visited.has(filePath)) return new Set()
    visited.add(filePath)

    const deps = new Set<string>()
    const imports = extractImports(filePath)

    for (const imp of imports) {
      deps.add(imp)

      const possibleExtensions = ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx']
      for (const ext of possibleExtensions) {
        const fullPath = imp + ext
        if (existsSync(fullPath)) {
          deps.add(fullPath)
          const subDeps = getDependencies(fullPath, visited)
          subDeps.forEach(d => deps.add(d))
        }
      }
    }

    return deps
  }

  for (const testFile of testFiles) {
    const fullPath = resolve(PROJECT_ROOT, testFile)
    const deps = getDependencies(fullPath, new Set())
    graph.set(fullPath, deps)
  }

  return graph
}

function findRelatedTests(
  changedFiles: ChangedFiles,
  dependencyGraph: Map<string, Set<string>>
): string[] {
  const relatedTests = new Set<string>()
  const allChanged = [...changedFiles.added, ...changedFiles.modified]

  for (const changedFile of allChanged) {
    const absolutePath = resolve(PROJECT_ROOT, changedFile)

    for (const [testFile, dependencies] of Array.from(dependencyGraph.entries())) {
      if (dependencies.has(absolutePath) || testFile.includes(changedFile)) {
        relatedTests.add(testFile)
      }
    }
  }

  return Array.from(relatedTests)
}

function isInfrastructureTest(testFile: string): boolean {
  const infrastructurePatterns = [
    '/db/',
    '/config',
    '/driver',
    '/test-setup',
    'vitest.setup',
    'vitest.integration.setup',
  ]

  return infrastructurePatterns.some(pattern => testFile.includes(pattern))
}

function runTests(testFiles: string[]): void {
  if (testFiles.length === 0) {
    console.log('✅ No related tests to run')
    process.exit(0)
  }

  console.log('\n🎯 Running related tests:\n')
  testFiles.forEach(file => {
    const relativePath = relative(PROJECT_ROOT, file)
    const type = isInfrastructureTest(file) ? '🏗️  [Infrastructure]' : '📦 [Business]'
    console.log(`  ${type} ${relativePath}`)
  })
  console.log('')

  const testPaths = testFiles.map(f => relative(PROJECT_ROOT, f))

  try {
    const command = `npx vitest run ${testPaths.map(p => `"${p}"`).join(' ')}`
    console.log(`Executing: ${command}\n`)
    execSync(command, { stdio: 'inherit' })
    process.exit(0)
  } catch (error) {
    process.exit(1)
  }
}

function main(): void {
  const args = process.argv.slice(2)
  const runAll = args.includes('--all')
  const infrastructureOnly = args.includes('--infrastructure')

  if (runAll) {
    console.log('🏃 Running all tests...\n')
    execSync('npx vitest run', { stdio: 'inherit' })
    process.exit(0)
  }

  console.log('🔍 Analyzing changes...')

  const changedFiles = getChangedFiles()
  const allChanged = [...changedFiles.added, ...changedFiles.modified, ...changedFiles.deleted]

  if (allChanged.length === 0) {
    console.log('✅ No changes detected')
    process.exit(0)
  }

  console.log('\n📝 Changed files:')
  allChanged.forEach(file => console.log(`  - ${file}`))

  console.log('\n🔍 Building dependency graph...')
  const testFiles = findTestFiles()
  const dependencyGraph = buildDependencyGraph(testFiles)

  let relatedTests = findRelatedTests(changedFiles, dependencyGraph)

  if (infrastructureOnly) {
    relatedTests = relatedTests.filter(isInfrastructureTest)
    console.log('\n🏗️  Filtering infrastructure tests only...')
  }

  runTests(relatedTests)
}

main()

# OZ Extension Testing Documentation

This document describes the comprehensive testing infrastructure for the OZ MCP Chrome Extension.

## Overview

The extension now includes enhanced test coverage for the top 6 real estate listing sites with comprehensive E2E testing, site monitoring, and automated workflows.

## Supported Sites

### Residential Sites
- **Zillow.com** - Uses property card selectors and test attributes
- **Realtor.com** - Supports structured data and RUI components  
- **Redfin.com** - Handles split address components and RF test IDs

### Commercial Sites
- **LoopNet.com** - Supports placard addresses and breadcrumb extraction
- **Crexi.com** - Uses Material-UI components and test IDs
- **CommercialSearch.com** - CoStar-style structured addresses

## Test Architecture

### Directory Structure
```
tests/
├── setup/
│   ├── global-setup.ts         # Global test configuration
│   └── global-teardown.ts      # Cleanup and reporting
├── helpers/
│   ├── extension-loader.ts     # Chrome extension loader
│   ├── address-validator.ts    # Address validation utilities
│   ├── test-utils.ts          # Common test utilities
│   └── site-monitor.ts        # Site health monitoring
├── fixtures/
│   └── test-addresses.json    # Test data for all sites
├── e2e/
│   ├── sites/
│   │   ├── residential/       # Zillow, Realtor, Redfin tests
│   │   ├── commercial/        # LoopNet, Crexi, CommercialSearch tests
│   │   └── all-sites.spec.ts  # Cross-site integration tests
│   └── monitoring.spec.ts     # Site monitoring tests
└── unit/
    └── smoke.test.ts          # Basic unit tests
```

## Test Scripts

### Unit Testing
```bash
npm test                # Run all unit tests
npm run test:watch      # Watch mode
npm run test:coverage   # Coverage report
```

### E2E Testing
```bash
npm run e2e             # Run all E2E tests
npm run e2e:headed      # Run with browser UI
npm run e2e:debug       # Debug mode

# Site-specific tests
npm run e2e:residential # Test residential sites only
npm run e2e:commercial  # Test commercial sites only
npm run e2e:zillow      # Test Zillow specifically
npm run e2e:realtor     # Test Realtor.com specifically
npm run e2e:redfin      # Test Redfin specifically
npm run e2e:loopnet     # Test LoopNet specifically
npm run e2e:crexi       # Test Crexi specifically
npm run e2e:commercialsearch # Test CommercialSearch specifically

# Comprehensive testing
npm run e2e:all         # All-sites integration tests
npm run e2e:monitoring  # Site monitoring tests
```

### Reports and Monitoring
```bash
npm run e2e:report      # View test reports
npm run monitor         # Run monitoring and generate reports
npm run clean           # Clean test artifacts
```

## Site-Specific Detection

The extension now includes enhanced site-specific configurations:

### Address Selectors
Each site has custom selectors optimized for their DOM structure:
- Zillow: `[data-test="property-card-addr"]`, `.list-card-addr`
- Realtor: `[data-testid="card-address"]`, `.ldp-header-address-wrapper`
- Redfin: `.homecardV2Address`, `[data-rf-test-id="abp-streetLine"]`
- LoopNet: `.placard-address`, `.property-address`
- Crexi: `[data-testid="property-address"]`, `.property-header__address`
- CommercialSearch: `.property-address`, `[data-cy="property-address"]`

### Extraction Strategies
Custom extraction logic per site:
- **Standard**: Basic text cleaning
- **Realtor**: Handles microdata structure with `itemprop` attributes
- **Redfin**: Combines street address and city/state/zip components
- **LoopNet**: Processes breadcrumb navigation and structured lines
- **CoStar**: Handles multi-line address components

### Dynamic Content Handling
- Site-specific wait selectors for dynamic loading
- Configurable scan delays (1000-1500ms)
- Mutation observer integration for SPA navigation

## Monitoring System

### Automated Site Health Checks
- Daily monitoring via GitHub Actions
- Selector health validation (60% threshold)
- Critical failure detection (<40% success rate)
- Slack notifications for failures

### Monitoring Reports
- Success rate per site
- Failed vs working selectors
- Historical health tracking
- Actionable remediation suggestions

## CI/CD Integration

### GitHub Actions Workflows
- **Unit Tests**: Run on every PR/push
- **E2E Tests**: Matrix strategy across all sites
- **Site Monitoring**: Daily automated runs
- **Performance Tests**: Benchmark tracking
- **Security Scans**: Dependency auditing

### Artifacts and Reporting
- HTML test reports
- JSON results for programmatic access
- JUnit XML for CI integration
- Screenshots on failures
- Monitoring alerts and recommendations

## Configuration Files

### Playwright Config
- Multi-project setup for parallel testing
- Site-specific test projects
- Extension loading configuration
- Browser launch options

### Test Data
- Verified OZ and non-OZ addresses
- Site-specific test URLs
- Mock API response scenarios
- Address validation patterns

## Usage Examples

### Running Tests for a Specific Site
```bash
# Test only Zillow integration
npm run e2e:zillow

# Test all residential sites
npm run e2e:residential

# Run monitoring checks
npm run e2e:monitoring
```

### Local Development
```bash
# Start development with watch mode
npm run test:watch

# Debug specific test
npm run e2e:debug -- tests/e2e/sites/residential/zillow.spec.ts

# View reports after testing
npm run e2e:report
```

### CI Integration
```bash
# Full CI test suite
npm run ci:test

# Monitor site health
npm run monitor
```

## Maintenance

### Updating Site Configurations
1. Modify selectors in `content.js` SITE_CONFIGS
2. Update monitoring configurations in `site-monitor.ts`
3. Add test cases in relevant spec files
4. Verify with `npm run e2e:monitoring`

### Adding New Sites
1. Add configuration to SITE_CONFIGS
2. Create extraction strategy if needed
3. Add test fixtures in `test-addresses.json`
4. Create site-specific test file
5. Update monitoring system
6. Add CI matrix entry

### Debugging Failed Tests
1. Check HTML reports: `npm run e2e:report`
2. Review screenshots in `test-results/`
3. Run with debug: `npm run e2e:debug`
4. Check monitoring reports for site changes

## Best Practices

### Test Writing
- Use site-specific selectors from configs
- Mock API responses for predictable results
- Test both OZ and non-OZ addresses
- Include edge cases and error scenarios

### Site Monitoring
- Monitor critical selectors regularly
- Set appropriate health thresholds
- Include remediation suggestions in alerts
- Track historical trends

### CI/CD
- Run tests on all supported browsers
- Parallel execution for faster feedback
- Artifact collection for debugging
- Automated reporting and notifications

This comprehensive testing infrastructure ensures the extension maintains compatibility across all major real estate platforms while providing early detection of site changes that could break functionality.
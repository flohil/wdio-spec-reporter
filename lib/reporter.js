import events from 'events'
import humanizeDuration from 'humanize-duration'

const DURATION_OPTIONS = {
    units: ['m', 's'],
    round: true,
    spacer: ''
}

/**
 * Initialize a new `spec` test reporter.
 *
 * @param {Runner} runner
 * @api public
 */
class SpecReporter extends events.EventEmitter {
    constructor (baseReporter, config, options = {}) {
        super()

        this.baseReporter = baseReporter
        this.config = config
        this.options = options
        this.shortEnglishHumanizer = humanizeDuration.humanizer({
            language: 'shortEn',
            languages: { shortEn: {
                h: () => 'h',
                m: () => 'm',
                s: () => 's',
                ms: () => 'ms'
            }}
        })

        this.errorCount = 0
        this.indents = {}
        this.suiteIndents = {}
        this.specs = {}
        this.results = {}
        this.startedSpecs = false

        if (this.config.instantReport) {
            this.currentSuite = undefined
        }

        this.on('startSpecs', (runner) => {
            if (!this.startedSpecs) {
                this.printSuitesSummary()

                this.results[runner.cid] = {
                    passing: 0,
                    pending: 0,
                    failing: 0,
                    broken: 0,
                    unverified: 0
                }

                this.errorCount = 0

                this.startedSpecs = true
            }
        })

        this.on('runner:start', function (runner) {
            this.suiteIndents[runner.cid] = {}
            this.indents[runner.cid] = 0
            this.specs[runner.cid] = runner.specs
            this.results[runner.cid] = {
                passing: 0,
                pending: 0,
                failing: 0,
                broken: 0,
                unverified: 0
            }

            if (this.startedSpecs) {
                if (this.config.instantReport) {
                    this.printRunnerInfo(runner)
                }
            }
        })

        // printNow
        this.on('runner:init', (runner) => {
            if (this.config.instantReport) {
                this.printRunnerInfo(runner)
            }
        })

        this.on('suite:start', function (suite) {
            this.suiteIndents[suite.cid][suite.uid] = ++this.indents[suite.cid]

            if (this.config.instantReport) {
                this.currentSuite = suite
                this.printSuiteTitle(suite)
            }
        })

        this.on('test:pending', function (test) {
            this.results[test.cid].pending++
            this.currentTest = undefined

            if (this.config.instantReport) {
                test.state = 'pending'
                this.printTest(test)
            }
        })

        this.on('test:pass', function (test) {
            this.results[test.cid].passing++
            this.currentTest = undefined

            if (this.config.instantReport) {
                test.state = 'pass'
                this.printTest(test)
            }
        })

        this.on('test:fail', function (test) {
            this.results[test.cid].failing++
            this.currentTest = undefined

            if (this.config.instantReport) {
                test.state = 'fail'
                this.printTest(test)
            }
        })

        this.on('test:broken', function (test) {
            this.results[test.cid].broken++
            this.currentTest = undefined

            if (this.config.instantReport) {
                test.state = 'broken'
                this.printTest(test)
            }
        })

        this.on('test:unverified', function (test) {
            this.results[test.cid].unverified++
            this.currentTest = undefined

            if (this.config.instantReport) {
                test.state = 'unverified'
                this.printTest(test)
            }
        })

        this.on('suite:end', function (suite) {
            this.indents[suite.cid]--
        })

        this.on('runner:end', function (runner) {
            this.printSuiteResult(runner)
        })

        this.on('end', function () {
            if (this.startedSpecs) {
                this.printSuitesSummary()
            }
        })
    }

    indent (cid, uid) {
        const indents = this.suiteIndents[cid][uid]
        return indents === 0 ? '' : Array(indents).join('    ')
    }

    getSymbol (state) {
        const { symbols } = this.baseReporter
        let symbol = '?' // in case of an unknown state

        switch (state) {
        case 'pass':
            symbol = symbols.ok
            break
        case 'pending':
            symbol = '-'
            break
        case 'fail':
            this.errorCount++
            symbol = this.errorCount + ')'
            break
        case 'broken':
            this.errorCount++
            symbol = this.errorCount + ')'
            break
        default:
            this.errorCount++
            symbol = this.errorCount + ')'
            break
        }

        return symbol
    }

    getColor (state) {
        let color = null // in case of an unknown state

        switch (state) {
        case 'pass':
        case 'passing':
            color = 'green'
            break
        case 'pending':
            color = 'pending'
            break
        case 'fail':
        case 'failing':
            color = 'fail'
            break
        case 'unverified':
            color = 'unverified'
            break
        case 'broken':
            color = 'broken'
            break
        }

        return color
    }

    getBrowserCombo (caps, verbose = true) {
        const device = caps.deviceName
        const browser = caps.browserName || caps.browser
        const version = caps.version || caps.platformVersion || caps.browser_version
        const platform = caps.os ? (caps.os + ' ' + caps.os_version) : (caps.platform || caps.platformName)

        /**
         * mobile capabilities
         */
        if (device) {
            const program = (caps.app || '').replace('sauce-storage:', '') || caps.browserName
            const executing = program ? `executing ${program}` : ''

            if (!verbose) {
                return `${device} ${platform} ${version}`
            }

            return `${device} on ${platform} ${version} ${executing}`.trim()
        }

        if (!verbose) {
            return (browser + ' ' + (version || '') + ' ' + (platform || '')).trim()
        }

        return browser + (version ? ` (v${version})` : '') + (platform ? ` on ${platform}` : '')
    }

    getResultList (cid, suites, preface = '') {
        let output = ''

        for (const specUid in suites) {
            // Remove "before all" tests from the displayed results
            if (specUid.indexOf('"before all"') === 0) {
                continue
            }

            const spec = suites[specUid]
            const indent = this.indent(cid, specUid)
            const specTitle = suites[specUid].title

            if (specUid.indexOf('"before all"') !== 0) {
                output += `${preface} ${indent}${specTitle}\n`
            }

            for (const testUid in spec.tests) {
                const test = spec.tests[testUid]
                const testTitle = spec.tests[testUid].title

                if (test.state === '') {
                    this.results[cid].pending++
                    test.state = 'pending'
                }

                output += preface
                output += '   ' + indent
                output += this.baseReporter.color(this.getColor(test.state), this.getSymbol(test.state))
                output += ' ' + testTitle + '\n'
            }

            output += preface.trim() + '\n'
        }

        return output
    }

    getSummary (states, duration, preface = '') {
        let output = ''
        let displayedDuration = false

        for (const state in states) {
            const testCount = states[state]
            let testDuration = ''

            /**
             * don't display 0 passing/pending/broken/unverified/failing test labels...
             */
            if (testCount === 0) {
                continue
            }

            /**
             * set duration
             */
            if (!displayedDuration) {
                testDuration = ' (' + this.shortEnglishHumanizer(duration, DURATION_OPTIONS) + ')'
            }

            output += preface + ' '
            output += this.baseReporter.color(this.getColor(state), testCount)
            output += ' ' + this.baseReporter.color(this.getColor(state), state)
            output += testDuration
            output += '\n'
            displayedDuration = true
        }

        return output
    }

    getFailureList (failures, preface) {
        let output = ''

        failures.forEach((test, i) => {
            const title = typeof test.parent !== 'undefined' ? test.parent + ' ' + test.title : test.title
            output += `${preface.trim()}\n`
            output += preface + ' ' + this.baseReporter.color('error title', `${(i + 1)}) ${title}:`) + '\n'

            const printErr = (err) => {
                let errMessageColor = typeof err.matcherName === 'undefined' ? 'bright yellow' : 'error message'

                if (test.unverified) {
                    errMessageColor = 'unverified'
                }

                const message = err.message.split(/\n/g).map((l) => `${preface} ${this.baseReporter.color(errMessageColor, l)}`).join('\n')
                output += `${message}\n`

                if (err.stack) {
                    const stack = err.stack.split(/\n/g).map((l) => `${preface} ${this.baseReporter.color('error stack', l)}`).join('\n')
                    output += `${stack}\n`
                }
            }

            if (test.errs && test.errs.length > 0) {
                test.errs.forEach(function (err, j) {
                    printErr(err)
                })
            } else {
                printErr(test.err)
            }
        })

        return output
    }

    getJobLink (results, preface) {
        if (!results.config.host) {
            return ''
        }

        let output = ''
        if (results.config.host.indexOf('saucelabs.com') > -1) {
            output += `${preface.trim()}\n`
            output += `${preface} Check out job at https://saucelabs.com/tests/${results.sessionID}\n`
            return output
        }

        return output
    }

    printRunnerInfo (runner) {
        const cid = runner.cid
        const stats = this.baseReporter.stats
        const results = stats.runners[cid]
        const combo = this.getBrowserCombo(results.capabilities)

        let output = '\n------------------------------------------------------------------\n'

        if (results.sessionID) {
            output += this.getPhase() + `Session ID: ${results.sessionID}\n`
        }

        if (this.startedSpecs) {
            output += this.getPhase() + `Spec File: ${this.specs[cid]}\n`
        } else {
            output += this.getPhase() + `Testcase File: ${this.specs[cid]}\n`
            output += this.getPhase() + `Running: ${combo}`
        }

        console.log(output)
    }

    printSuiteTitle (suite) {
        let output = this.getPhase()
        output += '\n'
        output += this.getPhase()
        output += this.indent(suite.cid, suite.uid)
        output += suite.title

        console.log(output)
    }

    printTest (test) {
        let output = this.getPhase()

        output += '   ' + this.indent(this.currentSuite.cid, this.currentSuite.uid)
        output += this.baseReporter.color(this.getColor(test.state), this.getSymbol(test.state))
        output += ' '
        output += test.title

        console.log(output)
    }

    getPhase () {
        if (this.startedSpecs) {
            return '[SPEC] '
        } else {
            return '[TESTCASE] '
        }
    }

    getSuiteResult (runner) {
        const cid = runner.cid
        const stats = this.baseReporter.stats
        const results = stats.runners[cid]
        const preface = this.getPhase() // `[${this.getBrowserCombo(results.capabilities, false)} #${cid}]`
        const specHash = stats.getSpecHash(runner)
        const spec = results.specs[specHash]
        const combo = this.getBrowserCombo(results.capabilities)
        const failures = stats.getFailures().filter((f) => f.cid === cid || Object.keys(f.runner).indexOf(cid) > -1)

        /**
         * don't print anything if no specs where executed
         */
        if (Object.keys(spec.suites).length === 0) {
            return ''
        }

        let output = ''

        output += '------------------------------------------------------------------\n'

        if (results.sessionID) {
            output += `${preface} Session ID: ${results.sessionID}\n`
        }

        if (this.startedSpecs) {
            output += this.getPhase() + `Spec File: ${this.specs[cid]}\n`
        } else {
            output += this.getPhase() + `Testcase File: ${this.specs[cid]}\n`
            output += this.getPhase() + `Running: ${combo}`
        }

        output += `${preface}\n`
        output += this.getResultList(cid, spec.suites, preface)
        output += `${preface}\n`
        output += this.getSummary(this.results[cid], spec._duration, preface)
        output += this.getFailureList(failures, preface)
        output += this.getJobLink(results, preface)
        output += `${preface}\n`
        return output
    }

    printSuiteResult (runner) {
        if (!this.config.instantReport) {
            console.log(this.getSuiteResult(runner))
        }
    }

    printSuitesSummary () {
        const epilogue = this.baseReporter.epilogue
        epilogue.call(this.baseReporter)
    }
}

export default SpecReporter

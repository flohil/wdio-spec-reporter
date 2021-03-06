import events from 'events'
import humanizeDuration from 'humanize-duration'
import util from 'util'

const DURATION_OPTIONS = {
    units: ['m', 's'],
    round: true,
    spacer: ''
}

const STACKTRACE_FILTER = /(node_modules(\/|\\)(\w+)*|wdio-sync\/build|- - - - -)/g

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
        this.failureCount = 0
        this.indents = {}
        this.stepIndents = {}
        this.stepIndentWidth = 2
        this.stepIndentOffset = 1
        this.suiteIndents = {}
        this.specs = {}
        this.results = {}
        this.startedSpecs = false
        this.retryCount = 0
        this.currentTest = undefined

        if (this.config.reportResultsInstantly) {
            this.currentSuite = undefined
        }

        this.on('startSpecs', (runner) => {
            if (!this.startedSpecs) {
                this.results[runner.cid] = {
                    passing: 0,
                    pending: 0,
                    failing: 0,
                    broken: 0,
                    unvalidated: 0
                }

                this.failureCount = 0
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
                unvalidated: 0
            }

            if (this.startedSpecs) {
                if (this.config.reportResultsInstantly) {
                    this.printRunnerInfo(runner)
                }
            }
        })

        // printNow
        this.on('runner:init', (runner) => {
            if (this.config.reportResultsInstantly) {
                this.printRunnerInfo(runner)
            }
        })

        this.on('suite:start', function (suite) {
            this.suiteIndents[suite.cid][suite.uid] = ++this.indents[suite.cid]

            if (this.config.reportResultsInstantly) {
                this.currentSuite = suite
                this.printSuiteTitle(suite)
            }
        })

        this.on('test:setCurrentId', function (test) {
            this.retryCount = 0
            this.currentTest = test

            if ((this.config.consoleLogLevel === 'testcases' || this.config.consoleLogLevel === 'steps') && !this.startedSpecs) {
                this.printTestcaseTitle(test)

                if (this.config.consoleLogLevel === 'steps') {
                    this.stepIndents[test.cid] = 0
                }
            }
        })

        this.on('test:pending', function (test) {
            this.results[test.cid].pending++
            this.currentTest = undefined

            if (this.config.reportResultsInstantly) {
                test.state = 'pending'
                this.printTest(test)
            }
        })

        this.on('test:pass', function (test) {
            this.results[test.cid].passing++
            this.currentTest = undefined

            if (this.config.reportResultsInstantly) {
                test.state = 'pass'
                this.printTest(test)
            }
        })

        this.on('test:fail', function (test) {
            this.results[test.cid].failing++
            this.currentTest = undefined

            if (this.config.reportResultsInstantly) {
                test.state = 'fail'
                this.printTest(test)
            }
        })

        this.on('test:broken', function (test) {
            this.results[test.cid].broken++
            this.currentTest = undefined

            if (this.config.reportResultsInstantly) {
                test.state = 'broken'
                this.printTest(test)
            }

            if (this.config.reportErrorsInstantly && !test.finishedTests) {
                this.instantReportError(test.errs[test.errs.length - 1], 'bright yellow')
            }
        })

        this.on('test:unvalidated', function (test) {
            this.results[test.cid].unvalidated++
            this.currentTest = undefined

            if (this.config.reportResultsInstantly) {
                test.state = 'unvalidated'
                this.printTest(test)
            }
        })

        this.on('validate:failure', function (data) {
            if (this.config.reportErrorsInstantly) {
                const assertion = (this.config.cleanStackTraces) ? this.cleanStack(data.assertion) : data.assertion

                this.instantReportError(assertion, 'error message')
            }
        })

        this.on('suite:end', function (suite) {
            this.indents[suite.cid]--

            if ((this.config.consoleLogLevel === 'testcases' ||
                this.config.consoleLogLevel === 'steps') && !this.startedSpecs) {
                console.log()
            }
        })

        this.on('runner:end', function (runner) {
            this.printSuiteResult(runner)
        })

        this.on('end', function () {
            if (this.startedSpecs) {
                this.printSuitesSummary()
                this.baseReporter.writeCompleteOutput()
            }
        })

        this.on('step:start', function (step) {
            if (step.title && !this.startedSpecs && this.config.consoleLogLevel === 'steps') {
                this.stepIndents[step.cid]++

                if (this.logStep(step)) {
                    console.log(`${this.stepIndent(step.cid)}STEP: "${step.description}"`)

                    const arg = JSON.parse(step.arg)

                    if (Object.keys(arg).length > 0) {
                        const argStr = util.inspect(arg)
                        const argLines = argStr.split('\n').map(line => this.stepIndent(step.cid) + line)

                        argLines.forEach(line => console.log(this.baseReporter.color('error stack', line)))
                    }
                }
            }
        })

        this.on('retry:failed', function (step) {
            this.retryCount++

            if ((this.config.consoleLogLevel === 'testcases' || this.config.consoleLogLevel === 'steps') && !this.startedSpecs) {
                this.stepIndents[step.cid] = 0
                this.printTestcaseTitle(this.currentTest, this.retryCount)
            }
        })

        this.on('retry:broken', function (step) {
            this.retryCount++

            if (this.config.reportErrorsInstantly) {
                this.instantReportError(step.assertion, 'bright yellow')
            }

            if ((this.config.consoleLogLevel === 'testcases' || this.config.consoleLogLevel === 'steps') && !this.startedSpecs) {
                this.stepIndents[step.cid] = 0

                this.printTestcaseTitle(this.currentTest, this.retryCount)
            }
        })

        this.on('retry:validateFailure', function (message) {
            if (this.config.reportErrorsInstantly) {
                this.instantReportError(message.assertion, 'error message')
            }
        })

        this.on('step:end', function (step) {
            if (!this.startedSpecs && this.config.consoleLogLevel === 'steps') {
                this.stepIndents[step.cid]--
            }
        })
    }

    indent (cid, uid) {
        const indents = this.suiteIndents[cid][uid]
        return indents === 0 ? '' : Array(indents).join('    ')
    }

    stepIndent (cid, inline = 0) {
        const indents = this.stepIndentOffset + inline + this.stepIndents[cid] * this.stepIndentWidth
        return indents === 0 ? '' : Array(indents).join(' ')
    }

    logStep (step) {
        const title = step.title

        if (title && title !== 'Callback' && !title.startsWith('validate: {')) {
            return true
        }

        return false
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
        case 'unvalidated':
            color = 'unvalidated'
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
                    this.baseReporter.stats.counts.pending++;
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
             * don't display 0 passing/pending/broken/unvalidated/failing test labels...
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

            const printedState = (state === 'pending') ? 'skipped' : state;

            output += preface + ' '
            output += this.baseReporter.color(this.getColor(state), testCount)
            output += ' ' + this.baseReporter.color(this.getColor(state), printedState)
            output += testDuration
            output += '\n'
            displayedDuration = true
        }

        return output
    }

    getFailureList (failures, preface) {
        let output = ''

        failures.forEach((test, i) => {
            const title = test.printTitle
            output += `\n`
            output += this.baseReporter.color('error title', `${(++this.failureCount)}) ${title.trim()}:`) + '\n\n'

            const printErr = (err) => {
                let errMessageColor = typeof err.matcherName === 'undefined' && err.stack ? 'bright yellow' : 'error message'

                if (test.unvalidated) {
                    errMessageColor = 'unvalidated'
                }

                err.message = err.message.trim()

                const message = err.message.split(/\n/g).map((l) => `${this.baseReporter.color(errMessageColor, l)}`).join('\n')
                output += `${message}\n`

                if (err.stack) {
                    const stack = err.stack.split(/\n/g).map((l) => `${this.baseReporter.color('error stack', l)}`).join('\n')
                    output += `${stack}\n`
                }

                output += '\n'
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

        this.baseReporter.log(output)
    }

    printSuiteTitle (suite) {
        let output = this.getPhase()
        output += '\n'
        output += this.getPhase()
        output += this.indent(suite.cid, suite.uid)
        output += suite.title

        this.baseReporter.log(output)
    }

    printTestcaseTitle (test, retry) {
        const retryStr = (retry) ? ` (Retry ${retry})` : ''

        let output = `TESTCASE: "${test.id}"...${retryStr}`

        if (this.config.consoleLogLevel === 'steps') {
            output = '\n' + output
        }

        console.log(this.baseReporter.color('log testcase', output))
    }

    printTest (test) {
        let output = this.getPhase()

        output += '   ' + this.indent(this.currentSuite.cid, this.currentSuite.uid)
        output += this.baseReporter.color(this.getColor(test.state), this.getSymbol(test.state))
        output += ' '
        output += test.title

        this.baseReporter.log(output)
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
            output += this.getPhase() + ` Spec File: ${this.specs[cid]}\n`
        } else {
            output += this.getPhase() + ` Testcase File: ${this.specs[cid]}\n`
            output += this.getPhase() + ` Running: ${combo}\n`
        }

        output += `${preface}\n`
        output += this.getResultList(cid, spec.suites, preface)
        output += `${preface}\n`
        output += this.getSummary(this.results[cid], spec._duration, preface)
        output += '------------------------------------------------------------------\n'
        output += this.getFailureList(failures, preface)
        output += this.getJobLink(results, preface)
        return output
    }

    printSuiteResult (runner) {
        if (!this.config.reportResultsInstantly) {
            this.baseReporter.log(this.getSuiteResult(runner))
        }
    }

    printSuitesSummary () {
        const epilogue = this.baseReporter.epilogue
        epilogue.call(this.baseReporter)
    }

    cleanStack (error) {
        let stack = error.stack.split('\n')
        stack = stack.filter((line) => !line.match(STACKTRACE_FILTER) && line.startsWith('    at '))
        error.stack = stack.join('\n')
        return error
    }

    instantReportError (err, errMessageColor) {
        let output = ''

        err.message = err.message.trim()

        const message = err.message.split(/\n/g).map((l) => `${this.baseReporter.color(errMessageColor, l)}`).join('\n')
        output += `\n${message}\n`

        if (err.stack) {
            const stack = err.stack.split(/\n/g).map((l) => `${this.baseReporter.color('error stack', l)}`).join('\n')
            output += `${stack}\n`
        }

        output += '\n'

        this.baseReporter.log(output)
    }
}

export default SpecReporter

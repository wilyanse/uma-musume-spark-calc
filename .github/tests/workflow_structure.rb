# Structural assertions on the parsed workflow YAML (T12 review B1/B2/B3/B4/S1/S7/N1/N2/N3).
# Run by .github/tests/run.sh. Exits non-zero listing every violated assertion.
require 'yaml'

def load(name)
  YAML.load_file(File.join(ENV['WORKFLOW_DIR'] || File.join(__dir__, '..', 'workflows'), name))
end

errors = []
check = ->(cond, msg) { errors << msg unless cond }
all_steps = ->(job) { job.fetch('steps', []) }
runs = ->(job) { all_steps.(job).map { |s| s['run'].to_s }.join("\n") }

# ---- deploy.yml (B1, B2, S3)
deploy = load('deploy.yml')
on = deploy['on'] || deploy[true] # YAML 1.1 parses the bare key `on` as true
check.(on.keys == ['workflow_run'], 'deploy: only workflow_run may trigger it')
check.(on.dig('workflow_run', 'workflows') == ['CI'] && on.dig('workflow_run', 'types') == ['completed'], 'deploy: must follow completed CI runs')
check.(deploy['concurrency'] == { 'group' => 'production-deploy', 'cancel-in-progress' => false }, 'deploy: concurrency production-deploy with cancel-in-progress false')
check.(deploy['permissions'] == { 'contents' => 'read' }, 'deploy: permissions must be contents: read only')
gate = deploy.dig('jobs', 'gate') || {}
job = deploy.dig('jobs', 'deploy') || {}
required_conds = [
  "github.event.workflow_run.conclusion == 'success'",
  "github.event.workflow_run.event == 'push'",
  "github.event.workflow_run.head_branch == 'main'",
  'github.event.workflow_run.head_repository.full_name == github.repository'
]
required_conds.each do |c|
  check.(gate['if'].to_s.include?(c), "deploy: gate job if lacks #{c}")
  check.(job['if'].to_s.include?(c), "deploy: deploy job if lacks #{c}")
end
check.(job['needs'] == 'gate' && job['if'].to_s.include?("needs.gate.outputs.proceed == 'true'"), 'deploy: deploy job must need the gate and its proceed output')
gate_checkout = all_steps.(gate).find { |s| s['uses'].to_s.start_with?('actions/checkout@') }
check.(gate_checkout && !gate_checkout.fetch('with', {}).key?('ref'), 'deploy: gate job must check out the trusted default branch, not the candidate ref')
check.(gate.to_s !~ /secrets\./, 'deploy: gate job must not reference secrets')
check.(gate['environment'].nil?, 'deploy: gate job must not enter the production environment')
check.(runs.(gate).include?('deploy-gate.sh trust'), 'deploy: gate job must run deploy-gate.sh trust')
check.(job['environment'] == 'production', 'deploy: deploy job must use the production environment')
steps = all_steps.(job)
idx = ->(pred) { steps.index { |s| pred.(s) } }
i_fresh = idx.(->(s) { s['run'].to_s.include?('deploy-gate.sh fresh') })
i_migrate = idx.(->(s) { s['run'].to_s.include?('d1 migrations apply') })
i_deploy = idx.(->(s) { s['run'].to_s =~ /wrangler deploy --env production/ })
i_pre = idx.(->(s) { s['run'].to_s.include?('--require-provisioned') })
i_install = idx.(->(s) { s['run'].to_s.include?('pnpm install') })
check.(i_fresh && i_migrate && i_deploy && i_fresh < i_migrate && i_migrate < i_deploy, 'deploy: order must be freshness -> migrations -> deploy')
check.(i_pre && i_install && i_pre < i_install, 'deploy: preflight must precede install/build')
[i_migrate, i_deploy].compact.each do |i|
  check.(steps[i]['if'] == "steps.fresh.outputs.proceed == 'true'", "deploy: step #{steps[i]['name']} must be gated on the freshness re-check")
end
steps.each do |s|
  env_secret = (s['env'] || {}).values.any? { |v| v.to_s =~ /secrets\.CLOUDFLARE_API_TOKEN }}|secrets\.CLOUDFLARE_ACCOUNT_ID }}/ }
  allowed = s['run'].to_s =~ /wrangler (d1 migrations apply|deploy)/
  check.(!env_secret || allowed, "deploy: Cloudflare secrets exposed to step '#{s['name'] || s['run'] || s['uses']}'")
  check.(!s.fetch('with', {}).key?('cache'), 'deploy: no dependency cache in the privileged job')
  check.(!s.fetch('with', {}).key?('version') || !s['uses'].to_s.start_with?('pnpm/action-setup'), 'deploy: pnpm version comes from packageManager (N1)')
end
check.(!deploy.to_s.include?('pnpm -r build'), 'deploy: never pnpm -r build')

# ---- ci.yml (B3, S1, S2, S8, N1, N2)
ci = load('ci.yml')
ts = ci.dig('jobs', 'typescript') || {}
tsr = runs.(ts)
%w[lint typecheck test].each { |s| check.(tsr =~ /^pnpm -r #{s}$/, "ci: must run pnpm -r #{s}") }
check.(ts['strategy'].nil?, 'ci: no hard-coded package matrix')
check.(tsr !~ /pnpm -r build/, 'ci: never pnpm -r build')
check.(tsr.scan(/--filter\s+(\S+)/).flatten.uniq == ['web'], 'ci: only the web build may be filtered')
check.(tsr.include?('check-workspace-coverage.mjs'), 'ci: workspace coverage check missing')
check.(tsr.include?('check-config.mjs .'), 'ci: MASTER_VERSION alignment check missing')
check.(tsr.include?('-le 250000'), 'ci: bundle limit must be 250000 bytes (N2)')
dn = ci.dig('jobs', 'dotnet') || {}
setup = all_steps.(dn).find { |s| s['uses'].to_s.start_with?('actions/setup-dotnet@') }
check.(setup && setup.dig('with', 'dotnet-version').to_s.split == %w[8.0.x 9.0.x], 'ci: setup-dotnet must install 8.0.x and 9.0.x')
%w[runtime core-tests windows-build].each { |g| check.(runs.(dn).include?("agent-gates.sh #{g}"), "ci: agent gate #{g} missing") }
check.(runs.(ci.dig('jobs', 'workflow-checks') || {}).include?('.github/tests/run.sh'), 'ci: regression checks must run in CI')

# ---- backup.yml (B4)
backup = load('backup.yml')
bj = backup.dig('jobs', 'backup')
bsteps = all_steps.(bj)
upload = bsteps.find { |s| s['uses'].to_s.start_with?('actions/upload-artifact@') }
check.(upload && upload.dig('with', 'path') == '${{ steps.backup.outputs.file }}', 'backup: upload must be exactly the encrypted file output')
enc = bsteps.find { |s| s['id'] == 'backup' }
check.(enc && enc['run'].to_s.include?('backup-d1.sh') && enc.dig('env', 'AGE_RECIPIENT') == '${{ vars.BACKUP_AGE_RECIPIENT }}', 'backup: encrypt step must use vars.BACKUP_AGE_RECIPIENT (public, not a secret)')
check.(enc && upload && bsteps.index(enc) < bsteps.index(upload), 'backup: encryption must precede upload')
check.(backup.to_s !~ /AGE-SECRET-KEY|secrets\.[A-Z_]*AGE/, 'backup: no private age key may be referenced on GitHub')
check.(bj['if'] == "github.ref == 'refs/heads/main'" && bj['environment'] == 'backup', 'backup: main-only, backup environment')
check.(backup.dig('concurrency', 'cancel-in-progress') == false && bj['timeout-minutes'], 'backup: concurrency + timeout (N3)')

# ---- agent-release.yml (S7, N3)
rel = load('agent-release.yml')
rj = rel.dig('jobs', 'release')
rel_runs = runs.(rj)
check.(rel_runs !~ /\$\{\{/, 'release: no ${{ }} interpolation inside pwsh scripts (S7)')
check.(rel_runs.include?('Get-ChildItem -LiteralPath publish -Filter *.exe -File'), 'release: resolve the exe explicitly')
# T19: the only release asset is the verified ZIP pairing the EXE with its licence/NOTICE texts.
rsteps = all_steps.(rj)
build = rsteps.find { |s| s['id'] == 'build' } || {}
brun = build['run'].to_s
check.(brun.include?('recipient_notices.py package $exe[0].FullName $zip --assets agent/src/Uma.Agent.Windows/obj/project.assets.json'), 'release: build step must verify and package recipient notices (T19)')
check.(brun.include?('test_recipient_notices.py'), 'release: notice-verifier regressions must run before packaging (T19)')
check.(brun.index('dotnet publish').to_i < brun.index('recipient_notices.py package').to_i, 'release: package after publish (T19)')
check.(brun.include?('"zip=$zip"') && !brun.include?('"exe='), 'release: build step outputs only the ZIP, never the bare EXE (T19)')
rupload = rsteps.find { |s| s['uses'].to_s.start_with?('actions/upload-artifact@') } || {}
check.(rupload.dig('with', 'path') == '${{ steps.build.outputs.zip }}', 'release: artifact must be the verified ZIP (T19)')
rel_create = rsteps.find { |s| s['run'].to_s.include?('gh release create') } || {}
crun = rel_create['run'].to_s
check.(crun.include?('gh release create $env:TAG $env:ZIP --verify-tag'), 'release: gh gets only the verified ZIP (T19)')
check.(crun.include?('recipient_notices.py verify-zip $env:ZIP') && crun.index('verify-zip') < crun.index('gh release create'), 'release: re-verify the ZIP before creating the release (T19)')
check.(rel_create.dig('env', 'ZIP') == '${{ steps.build.outputs.zip }}' && !(rel_create['env'] || {}).key?('EXE'), 'release: create step receives the ZIP path only (T19)')
check.(rel_runs.include?("-cnotmatch '^agent-v"), 'release: tag format validation retained')
rcheckout = rsteps.find { |s| s['uses'].to_s.start_with?('actions/checkout@') } || {}
check.(rcheckout.dig('with', 'persist-credentials') == false, 'release: checkout without persisted credentials')
check.(rel['permissions'] == { 'contents' => 'write' }, 'release: permissions contents: write only')
rsetup = all_steps.(rj).find { |s| s['uses'].to_s.start_with?('actions/setup-dotnet@') }
check.(rsetup && rsetup.dig('with', 'global-json-file') == 'agent/global.json', 'release: setup exact SDK from agent/global.json')
require 'json'
sdk = JSON.parse(File.read(File.join(__dir__, '../../agent/global.json')))
check.(sdk['sdk'] == { 'version' => '10.0.401', 'rollForward' => 'disable', 'allowPrerelease' => false }, 'release: SDK must be exactly 10.0.401 without roll-forward')
check.(brun.include?("$sdk = dotnet --version") && brun.include?("$sdk.Trim() -cne '10.0.401'"), 'release: verify resolved SDK before publish')
check.(rel['concurrency'] && rj['timeout-minutes'], 'release: concurrency + timeout (N3)')

# ---- all workflows: pinned actions, no pnpm version duplication, timeouts
%w[ci.yml deploy.yml backup.yml agent-release.yml].each do |f|
  wf = load(f)
  wf['jobs'].each do |name, j|
    check.(j['timeout-minutes'], "#{f}: job #{name} needs timeout-minutes (N3)")
    all_steps.(j).each do |s|
      next unless s['uses']
      check.(s['uses'] =~ /@[0-9a-f]{40}\z/, "#{f}: #{s['uses']} must be pinned to a commit SHA")
      check.(!(s['uses'].start_with?('pnpm/action-setup') && s.fetch('with', {}).key?('version')), "#{f}: pnpm version duplicated (N1)")
    end
  end
end

if errors.empty?
  puts 'workflow structure: all assertions hold'
else
  errors.each { |e| puts "violation: #{e}" }
  exit 1
end

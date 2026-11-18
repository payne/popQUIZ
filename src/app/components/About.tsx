export const REPO_URL = 'https://github.com/payne/popQUIZ';

export function About() {
  const known = __COMMIT_HASH__ !== 'unknown';
  return (
    <div class="home">
      <h1>About Pop Quiz</h1>
      <p class="lede">Take FCC amateur radio practice exams together and compare results.</p>
      <p class="lede">This app is Aaron KC0WIH's idea.  Thanks Aaron!</p>
      <dl class="about-facts">
        <dt>Source code</dt>
        <dd>
          <a href={REPO_URL} target="_blank" rel="noopener">
            {REPO_URL.replace(/^https:\/\//, '')}
          </a>
        </dd>
        <dt>Last updated</dt>
        <dd>{__COMMIT_DATE__}</dd>
        <dt>Commit</dt>
        <dd>
          {known ? (
            <a href={`${REPO_URL}/commit/${__COMMIT_HASH__}`} target="_blank" rel="noopener">
              <code>{__COMMIT_HASH__}</code>
            </a>
          ) : (
            <code>unknown</code>
          )}
        </dd>
        <dt>Version</dt>
        <dd>
          v{__APP_VERSION__} · built {__BUILD_DATE__}
        </dd>
      </dl>
    </div>
  );
}

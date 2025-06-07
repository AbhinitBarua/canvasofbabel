document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.copy-btn').forEach(copyBtn => {
        copyBtn.addEventListener('click', (event) => {
            const preElement = event.target.closest('pre');
            const codeToCopy = preElement?.querySelector('code')?.innerText;
            if (codeToCopy) {
                navigator.clipboard.writeText(codeToCopy).then(() => {
                    event.target.textContent = 'Copied!';
                    setTimeout(() => { event.target.textContent = 'Copy'; }, 2000);
                });
            }
        });
    });

    const sections = document.querySelectorAll('main.doc-content section');
    const sidebarLinks = document.querySelectorAll('.sidebar-nav a');
    const observer = new IntersectionObserver((entries) => {
        let lastVisibleId = null;
        entries.forEach(entry => { if (entry.isIntersecting) { lastVisibleId = entry.target.id; }});
        sidebarLinks.forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('href') === `#${lastVisibleId}`) link.classList.add('active');
        });
    }, { root: null, rootMargin: '-40% 0px -60% 0px', threshold: 0 });
    sections.forEach(section => observer.observe(section));
});
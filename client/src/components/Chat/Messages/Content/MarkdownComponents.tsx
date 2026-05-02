import React, { memo, useMemo, useRef, useEffect } from 'react';
import { useRecoilValue } from 'recoil';
import { useToastContext } from '@librechat/client';
import { PermissionTypes, Permissions, apiBaseUrl } from 'librechat-data-provider';
import CodeBlock from '~/components/Messages/Content/CodeBlock';
import useHasAccess from '~/hooks/Roles/useHasAccess';
import { useFileDownload } from '~/data-provider';
import { useCodeBlockContext } from '~/Providers';
import { handleDoubleClick } from '~/utils';
import { useLocalize } from '~/hooks';
import store from '~/store';

type TCodeProps = {
  inline?: boolean;
  className?: string;
  children: React.ReactNode;
};

export const code: React.ElementType = memo(({ className, children }: TCodeProps) => {
  const canRunCode = useHasAccess({
    permissionType: PermissionTypes.RUN_CODE,
    permission: Permissions.USE,
  });
  const match = /language-(\w+)/.exec(className ?? '');
  const lang = match && match[1];
  const isMath = lang === 'math';
  const isSingleLine = typeof children === 'string' && children.split('\n').length === 1;

  const { getNextIndex, resetCounter } = useCodeBlockContext();
  const blockIndex = useRef(getNextIndex(isMath || isSingleLine)).current;

  useEffect(() => {
    resetCounter();
  }, [children, resetCounter]);

  if (isMath) {
    return <>{children}</>;
  } else if (isSingleLine) {
    return (
      <code onDoubleClick={handleDoubleClick} className={className}>
        {children}
      </code>
    );
  } else {
    return (
      <CodeBlock
        lang={lang ?? 'text'}
        codeChildren={children}
        blockIndex={blockIndex}
        allowExecution={canRunCode}
      />
    );
  }
});

export const codeNoExecution: React.ElementType = memo(({ className, children }: TCodeProps) => {
  const match = /language-(\w+)/.exec(className ?? '');
  const lang = match && match[1];

  if (lang === 'math') {
    return children;
  } else if (typeof children === 'string' && children.split('\n').length === 1) {
    return (
      <code onDoubleClick={handleDoubleClick} className={className}>
        {children}
      </code>
    );
  } else {
    return <CodeBlock lang={lang ?? 'text'} codeChildren={children} allowExecution={false} />;
  }
});

type TAnchorProps = {
  href: string;
  children: React.ReactNode;
  target?: string;
  rel?: string;
};

export const a: React.ElementType = memo(({ href, children, target, rel }: TAnchorProps) => {
  const user = useRecoilValue(store.user);
  const { showToast } = useToastContext();
  const localize = useLocalize();

  const isInteractiveChart = useMemo(() => {
    if (!href) {
      return false;
    }
    // Check for interactive chart link from python-interpreter
    return (
      (href.includes('/app/plots/') || href.includes('/data/')) &&
      href.toLowerCase().split('?')[0].endsWith('.html')
    );
  }, [href]);

  const fixedHref = useMemo(() => {
    const baseURL = apiBaseUrl();
    if (href?.startsWith('/data/') || href?.startsWith('/app/plots/')) {
      return `${baseURL}${href}`;
    }
    return href;
  }, [href]);

  if (isInteractiveChart) {
    return (
      <div className="interactive-chart-container relative mb-4 h-[600px] w-full overflow-hidden rounded border border-gray-300 dark:border-gray-600">
        <iframe
          src={fixedHref}
          title="Interactive Chart"
          className="h-full w-full border-none bg-transparent"
          sandbox="allow-scripts allow-same-origin allow-popups"
        />
        <div className="absolute bottom-0 right-0 bg-white/80 p-2 text-xs text-black dark:bg-black/50 dark:text-white">
          <a
            href={fixedHref}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            Open in New Tab ↗
          </a>
        </div>
      </div>
    );
  }

  const {
    file_id = '',
    filename = '',
    filepath,
  } = useMemo(() => {
    const pattern = new RegExp(`(?:files|outputs)/${user?.id}/([^\\s]+)`);
    const match = href.match(pattern);
    if (match && match[0]) {
      const path = match[0];
      const parts = path.split('/');
      const name = parts.pop();
      const file_id = parts.pop();
      return { file_id, filename: name, filepath: path };
    }
    return { file_id: '', filename: '', filepath: '' };
  }, [user?.id, href]);

  const { refetch: downloadFile } = useFileDownload(user?.id ?? '', file_id);
  const props: { target?: string; onClick?: React.MouseEventHandler } = { target: '_new' };

  if (!file_id || !filename) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  }

  const handleDownload = async (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    try {
      const stream = await downloadFile();
      if (stream.data == null || stream.data === '') {
        console.error('Error downloading file: No data found');
        showToast({
          status: 'error',
          message: localize('com_ui_download_error'),
        });
        return;
      }
      const link = document.createElement('a');
      link.href = stream.data;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(stream.data);
    } catch (error) {
      console.error('Error downloading file:', error);
    }
  };

  props.onClick = handleDownload;
  props.target = '_blank';

  const domainServerBaseUrl = `${apiBaseUrl()}/api`;

  return (
    <a
      href={
        filepath?.startsWith('files/')
          ? `${domainServerBaseUrl}/${filepath}`
          : `${domainServerBaseUrl}/files/${filepath}`
      }
      {...props}
    >
      {children}
    </a>
  );
});

type TParagraphProps = {
  children: React.ReactNode;
};

export const p: React.ElementType = memo(({ children }: TParagraphProps) => {
  return <p className="mb-2 whitespace-pre-wrap">{children}</p>;
});

type TImageProps = {
  src?: string;
  alt?: string;
  title?: string;
  className?: string;
  style?: React.CSSProperties;
};

export const img: React.ElementType = memo(({ src, alt, title, className, style }: TImageProps) => {
  // Get the base URL from the API endpoints
  const baseURL = apiBaseUrl();

  // If src starts with /images/, prepend the base URL
  const fixedSrc = useMemo(() => {
    if (!src) return src;

    // Provide a fallback for local external domains like jvteststock.com if needed,
    // but typically we let absolute URLs pass through intact.
    // If it's already an absolute URL or starts with data:, return as is
    if (src.startsWith('http') || src.startsWith('data:')) {
      return src;
    }

    // Prepend base URL to the image path if it starts with /images/, /data/, or /app/plots/
    if (src.startsWith('/images/') || src.startsWith('/data/') || src.startsWith('/app/plots/')) {
        return `${baseURL}${src}`;
    }
    
    // Otherwise fallback to returning the original source
    return src;
  }, [src, baseURL]);

  // If the image is a .html file rendered as an image, render an iframe instead
  if (fixedSrc && fixedSrc.toLowerCase().split('?')[0].endsWith('.html')) {
    return (
      <iframe
        src={fixedSrc}
        className={className}
        style={{ ...style, width: '100%', minHeight: '400px', border: 'none', background: 'transparent' }}
        title={title || alt || 'Interactive Chart'}
      />
    );
  }

  return <img src={fixedSrc} alt={alt} title={title} className={className} style={style} />;
});

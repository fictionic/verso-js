import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Link } from '../userland/components/Link';
import { navigateTo } from '../userland/util/navigateTo';

vi.mock('../userland/util/navigateTo');

const mockNavigateTo = vi.mocked(navigateTo);

describe('Link', () => {
  beforeEach(() => {
    mockNavigateTo.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  test('plain left-click: preventDefault, calls navigateTo, calls onClick', () => {
    const onClick = vi.fn();
    render(<Link href="/about" onClick={onClick}>Go</Link>);
    fireEvent.click(screen.getByRole('link', { name: 'Go' }), { button: 0 });
    expect(mockNavigateTo).toHaveBeenCalledTimes(1);
    expect(mockNavigateTo).toHaveBeenCalledWith('/about', { reuseDom: undefined });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test('defaultPrevented -> bails: navigateTo not called, onClick not called', () => {
    const onClick = vi.fn();
    render(
      <div onClickCapture={(e) => e.preventDefault()}>
        <Link href="/about" onClick={onClick}>Go</Link>
      </div>,
    );
    fireEvent.click(screen.getByRole('link', { name: 'Go' }), { button: 0 });
    expect(mockNavigateTo).not.toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  });

  test('non-left button -> bails: navigateTo not called', () => {
    render(<Link href="/about">Go</Link>);
    fireEvent.click(screen.getByRole('link', { name: 'Go' }), { button: 1 });
    expect(mockNavigateTo).not.toHaveBeenCalled();
  });

  test('metaKey -> bails: navigateTo not called', () => {
    render(<Link href="/about">Go</Link>);
    fireEvent.click(screen.getByRole('link', { name: 'Go' }), { button: 0, metaKey: true });
    expect(mockNavigateTo).not.toHaveBeenCalled();
  });

  test('ctrlKey -> bails: navigateTo not called', () => {
    render(<Link href="/about">Go</Link>);
    fireEvent.click(screen.getByRole('link', { name: 'Go' }), { button: 0, ctrlKey: true });
    expect(mockNavigateTo).not.toHaveBeenCalled();
  });

  test('shiftKey -> bails: navigateTo not called', () => {
    render(<Link href="/about">Go</Link>);
    fireEvent.click(screen.getByRole('link', { name: 'Go' }), { button: 0, shiftKey: true });
    expect(mockNavigateTo).not.toHaveBeenCalled();
  });

  test('altKey -> bails: navigateTo not called', () => {
    render(<Link href="/about">Go</Link>);
    fireEvent.click(screen.getByRole('link', { name: 'Go' }), { button: 0, altKey: true });
    expect(mockNavigateTo).not.toHaveBeenCalled();
  });

  test('target="_blank" -> bails: navigateTo not called', () => {
    render(<Link href="/about" target="_blank">Go</Link>);
    fireEvent.click(screen.getByRole('link', { name: 'Go' }), { button: 0 });
    expect(mockNavigateTo).not.toHaveBeenCalled();
  });

  test('target="_self" -> intercepts: navigateTo called', () => {
    render(<Link href="/about" target="_self">Go</Link>);
    fireEvent.click(screen.getByRole('link', { name: 'Go' }), { button: 0 });
    expect(mockNavigateTo).toHaveBeenCalledWith('/about', { reuseDom: undefined });
  });

  test('reuseDom prop threads into navigateTo options', () => {
    render(<Link href="/about" reuseDom={true}>Go</Link>);
    fireEvent.click(screen.getByRole('link', { name: 'Go' }), { button: 0 });
    expect(mockNavigateTo).toHaveBeenCalledWith('/about', { reuseDom: true });
  });

  test('navigateTo rejecting logs error without unhandled rejection', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new Error('nav failed');
    mockNavigateTo.mockRejectedValueOnce(err);

    render(<Link href="/about">Go</Link>);
    fireEvent.click(screen.getByRole('link', { name: 'Go' }), { button: 0 });

    await vi.waitFor(() => {
      expect(errSpy).toHaveBeenCalledWith('[verso] navigation failed', err);
    });
  });

  test('rest props spread onto anchor; href is set', () => {
    render(
      <Link href="/about" className="nav-link" id="my-link">Go</Link>,
    );
    const anchor = screen.getByRole('link', { name: 'Go' });
    expect(anchor.getAttribute('href')).toBe('/about');
    expect(anchor.getAttribute('class')).toBe('nav-link');
    expect(anchor.getAttribute('id')).toBe('my-link');
  });
});
